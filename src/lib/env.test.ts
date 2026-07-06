const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('env', () => {
  it('exposes the configured Supabase URL and anon key', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- needs a fresh module eval per test, not a static import
    const { env } = require('./env');
    expect(env.supabaseUrl).toBe('http://localhost:54321');
    expect(env.supabaseAnonKey).toBe('anon-key');
  });

  it('throws a helpful error when EXPO_PUBLIC_SUPABASE_URL is missing', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- needs a fresh module eval per test, not a static import
    expect(() => require('./env')).toThrow(/Missing EXPO_PUBLIC_SUPABASE_URL/);
  });

  it('throws a helpful error when EXPO_PUBLIC_SUPABASE_ANON_KEY is missing', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- needs a fresh module eval per test, not a static import
    expect(() => require('./env')).toThrow(/Missing EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  });
});
