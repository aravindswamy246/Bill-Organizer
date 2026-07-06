jest.mock(
  '@react-native-async-storage/async-storage',
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories must use require, not import
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(),
}));

let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => `uuid-${++mockUuidCounter}`),
}));

// Minimal in-memory stand-in for the new class-based expo-file-system API
// (Directory/File/Paths) — just enough surface for offlineQueue.ts's usage.
jest.mock('expo-file-system', () => {
  const contents = new Map<string, Uint8Array>();

  class FakeFile {
    uri: string;
    constructor(source: string | FakeDirectory, name?: string) {
      this.uri = typeof source === 'string' ? source : `${source.uri}/${name}`;
    }
    get exists() {
      return contents.has(this.uri);
    }
    create() {
      contents.set(this.uri, new Uint8Array());
    }
    async copy(destination: FakeFile) {
      contents.set(destination.uri, contents.get(this.uri) ?? new Uint8Array([1, 2, 3]));
    }
    async bytes() {
      return contents.get(this.uri) ?? new Uint8Array([1, 2, 3]);
    }
    delete() {
      contents.delete(this.uri);
    }
  }

  class FakeDirectory {
    uri: string;
    constructor(parent: string | FakeDirectory, name: string) {
      this.uri = `${typeof parent === 'string' ? parent : parent.uri}/${name}`;
    }
    get exists() {
      return true;
    }
    create() {
      /* no-op: always exists */
    }
  }

  return {
    File: FakeFile,
    Directory: FakeDirectory,
    Paths: { document: 'file:///document', cache: 'file:///cache' },
  };
});

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    storage: { from: jest.fn() },
    from: jest.fn(),
  },
}));

beforeEach(() => {
  mockUuidCounter = 0;
});

// offlineQueue.ts keeps its queue in module-scope singleton state, and its
// dependencies (AsyncStorage/NetInfo/supabase) are jest.mock()'d singletons
// too. jest.resetModules() gives every test a clean slate, but that also
// means we must re-require the mocked dependencies *after* resetting so our
// assertions/configuration target the same instances the fresh module sees.
function loadQueueModule() {
  jest.resetModules();
  /* eslint-disable @typescript-eslint/no-require-imports -- must re-require after
     resetModules() so these target the same fresh mock instances the module sees */
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const NetInfo = require('@react-native-community/netinfo');
  const { supabase } = require('@/lib/supabase');
  const queueModule = require('./offlineQueue');
  /* eslint-enable @typescript-eslint/no-require-imports */

  const getSession = supabase.auth.getSession as jest.Mock;
  const storageFrom = supabase.storage.from as jest.Mock;
  const dbFrom = supabase.from as jest.Mock;
  getSession.mockResolvedValue({ data: { session: null } });

  function mockUploadResult(uploadError: unknown) {
    storageFrom.mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: uploadError }),
    });
  }

  function mockInsertResult(data: { id: string } | null, error: unknown) {
    dbFrom.mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data, error }),
        }),
      }),
    });
  }

  return {
    ...queueModule,
    AsyncStorage,
    NetInfo,
    getSession,
    storageFrom,
    dbFrom,
    mockUploadResult,
    mockInsertResult,
  };
}

describe('enqueueCapture', () => {
  it('copies the source file into app storage and persists a queue entry', async () => {
    const { enqueueCapture, getQueue, AsyncStorage } = loadQueueModule();

    const item = await enqueueCapture('file:///tmp/picked.jpg', 'image/jpeg', 'camera');

    expect(item.mimeType).toBe('image/jpeg');
    expect(item.extension).toBe('jpg');
    expect(item.source).toBe('camera');
    expect(item.attempts).toBe(0);
    expect(await getQueue()).toEqual([item]);

    const raw = await AsyncStorage.getItem('capture-queue/v1');
    expect(JSON.parse(raw)).toEqual([item]);
  });

  it('maps PDF and PNG mime types to the correct file extension', async () => {
    const { enqueueCapture } = loadQueueModule();

    const pdf = await enqueueCapture('file:///tmp/a.pdf', 'application/pdf');
    const png = await enqueueCapture('file:///tmp/b.png', 'image/png');
    const unknown = await enqueueCapture('file:///tmp/c.bin', undefined);

    expect(pdf.extension).toBe('pdf');
    expect(png.extension).toBe('png');
    expect(unknown.extension).toBe('jpg');
    expect(unknown.mimeType).toBe('image/jpeg');
  });

  it('appends to an existing queue rather than replacing it', async () => {
    const { enqueueCapture, getQueue } = loadQueueModule();

    await enqueueCapture('file:///tmp/1.jpg', 'image/jpeg');
    await enqueueCapture('file:///tmp/2.jpg', 'image/jpeg');

    expect(await getQueue()).toHaveLength(2);
  });
});

describe('processQueue', () => {
  it('does nothing when there is no active session (capture stays queued, never lost)', async () => {
    const { enqueueCapture, processQueue, getQueue, getSession } = loadQueueModule();
    await enqueueCapture('file:///tmp/1.jpg', 'image/jpeg');

    getSession.mockResolvedValue({ data: { session: null } });
    const result = await processQueue();

    expect(result.uploaded).toEqual([]);
    expect(await getQueue()).toHaveLength(1);
  });

  it('uploads a queued item and removes it from the queue on success', async () => {
    const { enqueueCapture, processQueue, getQueue, getSession, mockUploadResult, mockInsertResult } =
      loadQueueModule();
    const item = await enqueueCapture('file:///tmp/1.jpg', 'image/jpeg');

    getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
    mockUploadResult(null);
    mockInsertResult({ id: 'bill-1' }, null);

    const result = await processQueue();

    expect(result.uploaded).toEqual([{ itemId: item.id, billId: 'bill-1' }]);
    expect(await getQueue()).toEqual([]);
  });

  it('keeps a failed upload in the queue with an incremented attempt count', async () => {
    const { enqueueCapture, processQueue, getQueue, getSession, mockUploadResult } = loadQueueModule();
    const item = await enqueueCapture('file:///tmp/1.jpg', 'image/jpeg');

    getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
    // Real supabase-js StorageError/PostgrestError instances extend Error,
    // which is what lets uploadOne's catch block surface a real message.
    mockUploadResult(new Error('network blip'));

    const result = await processQueue();

    expect(result.uploaded).toEqual([]);
    const queue = await getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(item.id);
    expect(queue[0].attempts).toBe(1);
    expect(queue[0].lastError).toBe('network blip');
  });

  it('processes remaining items independently — one failure does not drop the others', async () => {
    const { enqueueCapture, processQueue, getQueue, getSession, storageFrom, mockInsertResult } =
      loadQueueModule();
    await enqueueCapture('file:///tmp/1.jpg', 'image/jpeg');
    await enqueueCapture('file:///tmp/2.jpg', 'image/jpeg');

    getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
    let call = 0;
    storageFrom.mockImplementation(() => ({
      upload: jest.fn().mockImplementation(() => {
        call += 1;
        return Promise.resolve({ error: call === 1 ? { message: 'boom' } : null });
      }),
    }));
    mockInsertResult({ id: 'bill-2' }, null);

    const result = await processQueue();

    expect(result.uploaded).toEqual([{ itemId: expect.any(String), billId: 'bill-2' }]);
    const queue = await getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].attempts).toBe(1);
  });

  it('returns immediately with no uploads when the queue is empty', async () => {
    const { processQueue, getSession } = loadQueueModule();
    getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });

    expect(await processQueue()).toEqual({ uploaded: [] });
    expect(getSession).not.toHaveBeenCalled();
  });
});

describe('watchNetworkAndProcess', () => {
  it('triggers a queue sweep when connectivity is restored', async () => {
    const {
      enqueueCapture,
      watchNetworkAndProcess,
      getSession,
      mockUploadResult,
      mockInsertResult,
      NetInfo,
    } = loadQueueModule();
    await enqueueCapture('file:///tmp/1.jpg', 'image/jpeg');
    getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
    mockUploadResult(null);
    mockInsertResult({ id: 'bill-1' }, null);

    watchNetworkAndProcess();
    const listener = (NetInfo.addEventListener as jest.Mock).mock.calls[0][0];
    await listener({ isConnected: true, isInternetReachable: true });

    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('does not sweep when offline', async () => {
    const { watchNetworkAndProcess, getSession, NetInfo } = loadQueueModule();
    watchNetworkAndProcess();
    const listener = (NetInfo.addEventListener as jest.Mock).mock.calls[0][0];

    await listener({ isConnected: false, isInternetReachable: false });

    expect(getSession).not.toHaveBeenCalled();
  });
});
