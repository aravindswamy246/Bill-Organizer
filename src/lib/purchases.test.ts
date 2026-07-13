const ORIGINAL_ENV = process.env;

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    getOfferings: jest.fn(),
    purchasePackage: jest.fn(),
    getCustomerInfo: jest.fn(),
  },
}));

function mockPlatformOS(os: 'ios' | 'android') {
  // purchases.ts only imports `Platform` from 'react-native', so a minimal
  // mock avoids pulling in the real native-module graph (which throws
  // outside a native runtime) while jest.requireActual would.
  jest.doMock('react-native', () => ({ Platform: { OS: os } }));
}

function loadPurchasesModule(): typeof import('./purchases') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- needs a fresh module eval per test, not a static import
  return require('./purchases');
}

function getMockedPurchasesSdk() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be re-required after jest.resetModules() to get the same instance the fresh module under test sees
  return (require('react-native-purchases') as { default: Record<string, jest.Mock> }).default;
}

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
  mockPlatformOS('ios');
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('REVENUECAT_CONFIGURED', () => {
  it('is false when no platform API key is set', () => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS;
    delete process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID;

    const { REVENUECAT_CONFIGURED } = loadPurchasesModule();
    expect(REVENUECAT_CONFIGURED).toBe(false);
  });

  it('is true on iOS when the iOS key is set', () => {
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS = 'ios-key';
    delete process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID;

    const { REVENUECAT_CONFIGURED } = loadPurchasesModule();
    expect(REVENUECAT_CONFIGURED).toBe(true);
  });

  it('is false on iOS when only the Android key is set', () => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS;
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID = 'android-key';

    const { REVENUECAT_CONFIGURED } = loadPurchasesModule();
    expect(REVENUECAT_CONFIGURED).toBe(false);
  });

  it('is true on Android when the Android key is set', () => {
    jest.resetModules();
    mockPlatformOS('android');
    delete process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS;
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID = 'android-key';

    const { REVENUECAT_CONFIGURED } = loadPurchasesModule();
    expect(REVENUECAT_CONFIGURED).toBe(true);
  });
});

describe('configurePurchases', () => {
  it('is a no-op when not configured', () => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS;
    delete process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID;

    const purchasesModule = loadPurchasesModule();
    const Purchases = getMockedPurchasesSdk();

    purchasesModule.configurePurchases('user-1');
    expect(Purchases.configure).not.toHaveBeenCalled();
  });

  it('configures the SDK with the platform key and Supabase user id once configured', () => {
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS = 'ios-key';

    const purchasesModule = loadPurchasesModule();
    const Purchases = getMockedPurchasesSdk();

    purchasesModule.configurePurchases('user-1');
    expect(Purchases.configure).toHaveBeenCalledWith({ apiKey: 'ios-key', appUserID: 'user-1' });
  });

  it('only configures the SDK once per module lifetime', () => {
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS = 'ios-key';

    const purchasesModule = loadPurchasesModule();
    const Purchases = getMockedPurchasesSdk();

    purchasesModule.configurePurchases('user-1');
    purchasesModule.configurePurchases('user-2');
    expect(Purchases.configure).toHaveBeenCalledTimes(1);
  });
});

describe('getCurrentOffering', () => {
  it('returns null in mock mode without calling the SDK', async () => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS;
    delete process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID;

    const purchasesModule = loadPurchasesModule();
    const Purchases = getMockedPurchasesSdk();

    await expect(purchasesModule.getCurrentOffering()).resolves.toBeNull();
    expect(Purchases.getOfferings).not.toHaveBeenCalled();
  });

  it('returns the current offering when configured', async () => {
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS = 'ios-key';

    const purchasesModule = loadPurchasesModule();
    const Purchases = getMockedPurchasesSdk();
    const current = { identifier: 'default' };
    Purchases.getOfferings.mockResolvedValue({ current });

    await expect(purchasesModule.getCurrentOffering()).resolves.toBe(current);
  });
});

describe('getCustomerInfo', () => {
  it('returns null in mock mode without calling the SDK', async () => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS;
    delete process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID;

    const purchasesModule = loadPurchasesModule();
    const Purchases = getMockedPurchasesSdk();

    await expect(purchasesModule.getCustomerInfo()).resolves.toBeNull();
    expect(Purchases.getCustomerInfo).not.toHaveBeenCalled();
  });

  it('returns the SDK customer info when configured', async () => {
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS = 'ios-key';

    const purchasesModule = loadPurchasesModule();
    const Purchases = getMockedPurchasesSdk();
    const info = { entitlements: { active: {} } };
    Purchases.getCustomerInfo.mockResolvedValue(info);

    await expect(purchasesModule.getCustomerInfo()).resolves.toBe(info);
  });
});

describe('purchasePackage', () => {
  it('purchases the package and returns the resulting customer info', async () => {
    process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS = 'ios-key';

    const purchasesModule = loadPurchasesModule();
    const Purchases = getMockedPurchasesSdk();
    const customerInfo = { entitlements: { active: {} } };
    Purchases.purchasePackage.mockResolvedValue({ customerInfo });

    const pkg = { identifier: 'monthly' } as never;
    await expect(purchasesModule.purchasePackage(pkg)).resolves.toBe(customerInfo);
    expect(Purchases.purchasePackage).toHaveBeenCalledWith(pkg);
  });
});

describe('isEntitlementActive', () => {
  it('returns false when info is null', () => {
    const { isEntitlementActive } = loadPurchasesModule();
    expect(isEntitlementActive(null)).toBe(false);
  });

  it('returns false when the premium entitlement is not active', () => {
    const { isEntitlementActive } = loadPurchasesModule();
    expect(isEntitlementActive({ entitlements: { active: {} } } as never)).toBe(false);
  });

  it('returns true when the premium entitlement is active', () => {
    const { isEntitlementActive, PREMIUM_ENTITLEMENT_ID } = loadPurchasesModule();
    const info = { entitlements: { active: { [PREMIUM_ENTITLEMENT_ID]: {} } } };
    expect(isEntitlementActive(info as never)).toBe(true);
  });
});
