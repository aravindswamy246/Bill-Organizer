-- Local dev seed data. Run automatically by `supabase db reset`.
-- Creates one demo auth user (email/password) with a completed profile and
-- a handful of bills across categories so the analytics/list/reminders
-- screens have something to render against during development.
--
-- Demo login: demo@billorganizer.dev / password123

insert into
  auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  )
values
  (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'demo@billorganizer.dev',
    crypt ('password123', gen_salt ('bf')),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    '',
    '',
    '',
    ''
  );

update public.profiles
set
  name = 'Demo User',
  phone_number = '+919876543210'
where
  id = '00000000-0000-0000-0000-000000000001';

insert into
  public.bills (
    id,
    user_id,
    merchant_name,
    bill_date,
    total_amount,
    category,
    source,
    status,
    is_warranty_document,
    is_insurance_document
  )
values
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'Croma Electronics',
    current_date - interval '10 days',
    45999.00,
    'Warranty',
    'camera',
    'confirmed',
    true,
    false
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'HDFC ERGO Health Insurance',
    current_date - interval '20 days',
    12500.00,
    'Insurance',
    'share_extension',
    'confirmed',
    false,
    true
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'BigBasket',
    current_date - interval '2 days',
    2340.50,
    'Dining & Grocery',
    'whatsapp_business',
    'confirmed',
    false,
    false
  ),
  (
    '10000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000001',
    'Tata Power',
    current_date - interval '5 days',
    1875.00,
    'Utilities',
    'camera',
    'confirmed',
    false,
    false
  );

insert into
  public.line_items (bill_id, description, amount)
values
  (
    '10000000-0000-0000-0000-000000000003',
    'Groceries',
    2340.50
  );

insert into
  public.reminders (
    bill_id,
    user_id,
    expiry_date,
    active
  )
values
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    current_date + interval '355 days',
    true
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    current_date + interval '345 days',
    true
  );
