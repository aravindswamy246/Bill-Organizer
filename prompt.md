# Bill Organizer — Build Prompt

You are building **Bill Organizer**, a React Native (iOS + Android) mobile app that lets a user capture every bill/receipt they receive, automatically extracts structured data from it using a vision-capable LLM, tags it to a category (with special handling for warranty and insurance items), and gives the user spend analytics plus proactive expiry reminders. This is a real product for the Indian market — build it production-quality, not a prototype.

## 1. Problem this solves
People receive bills across many channels (paper receipts, WhatsApp, PDFs, screenshots) with no central record. They lose track of warranty periods, forget insurance renewal dates, and have no visibility into spend patterns across categories. This app is the single place all of that lives.

## 2. Core user flows (build all of these for v1)

**Onboarding**
- Phone number signup/login with OTP (use Supabase Auth phone OTP, or Firebase Auth phone OTP)
- Minimal profile: name, phone number (this phone number is the identity key used for bill ingestion)

**Capturing a bill — THREE input methods, all must work:**
1. **In-app camera capture**: user photographs a physical receipt directly in-app
2. **Native Share-Extension / Share-Intent**: user is in WhatsApp (or Gallery, Files, any app), taps Share on an image/PDF, and "Bill Organizer" appears in the OS share sheet as a target. This is the primary "WhatsApp forward" path and needs no special WhatsApp API — it's a standard iOS Share Extension / Android `ACTION_SEND` intent filter registered by this app.
3. **WhatsApp Business Cloud API intake number**: separately, provision one WhatsApp Business Cloud API number (via Meta) that is *this app's* official "forward your bills here" number, shown in-app during onboarding ("Save this number, forward any bill to it"). Inbound images to this number arrive via webhook to your backend. Match the inbound bill to a user account by the **sender's phone number** matching the user's registered phone number. Note for the builder: this requires Meta Business verification as an external setup step outside the codebase — build the webhook receiver and account-matching logic assuming the number exists; don't block app functionality on this being live (Share-Extension and camera capture must work standalone).

**Bill parsing pipeline (for all 3 input methods)**
- Every captured image/PDF is sent to a vision-capable LLM (Claude or GPT-4V-class multimodal API) with a structured-extraction prompt that returns JSON: `{merchant_name, date, total_amount, currency, category_guess, line_items: [{description, amount}], is_warranty_document: bool, is_insurance_document: bool, detected_expiry_date: string|null}`.
- Do NOT build a regex/Tesseract-based parser — bill formats vary too much (thermal receipts, PDFs, screenshots, scanned insurance policies); vision-LLM extraction is the correct approach and must be used.
- After extraction, show the user a **confirm/edit screen** before saving — never silently trust 100% automated extraction for financial data. Pre-fill all fields from the LLM response; let the user correct merchant name, amount, date, and category with one tap.

**Categorization**
- Category set (fixed list for v1): Warranty, Insurance, Utilities, Subscriptions, Dining & Grocery, Medical, Travel, Other
- If `is_warranty_document` or `is_insurance_document` is true, or `detected_expiry_date` is present, prompt the user to confirm/set an **expiry date** and create a Reminder (see below)

**Reminders**
- For any bill tagged Warranty or Insurance with an expiry date, auto-schedule local + push notifications (use Firebase Cloud Messaging) at 30 days, 7 days, and 1 day before expiry: *"Your [merchant] warranty expires in [X] days"*
- Reminders list screen showing all upcoming expiries sorted by date

**Analytics dashboard**
- Monthly spend total, broken down by category (simple bar/pie chart)
- Month-over-month trend line for total spend
- Per-category drill-down: list of bills in that category for the selected month
- This is the core "free" hook — must feel valuable even on the free tier (see monetization)

**Bill list / search**
- Chronological list of all bills, filterable by category and date range, searchable by merchant name

## 3. Data model (Postgres via Supabase recommended for speed)

- `users`: id, phone_number, name, created_at, subscription_tier (free|premium)
- `bills`: id, user_id, merchant_name, bill_date, total_amount, currency, category, source (camera|share_extension|whatsapp_business), raw_image_url (private storage), extracted_json (raw LLM output for audit), created_at
- `line_items`: id, bill_id, description, amount
- `reminders`: id, bill_id, user_id, expiry_date, notified_30d (bool), notified_7d (bool), notified_1d (bool)
- `subscriptions`: id, user_id, tier, renewed_at, expires_at, store (app_store|play_store)

## 4. Recommended stack (optimize for fastest path to a working v1)
- **Frontend**: React Native (Expo preferred for faster iteration unless native modules force a bare workflow — Share Extensions may require ejecting from Expo managed workflow or using an Expo config plugin; use `expo-share-extension` or bare RN if needed)
- **Backend**: Supabase (Postgres + Auth + Storage + Edge Functions) — avoids building custom auth/infra from scratch
- **Bill parsing**: Claude API or GPT-4V API call from a Supabase Edge Function (never call the LLM API directly from the client — keep the API key server-side)
- **Push notifications**: Firebase Cloud Messaging
- **Subscription billing**: RevenueCat, wrapping native App Store / Play Store subscriptions — do not build custom billing/entitlement logic
- **Image storage**: Supabase Storage, private bucket, signed URLs only (bills contain financial PII — never store in a public bucket)

## 5. Monetization (Freemium)
- **Free tier**: unlimited bill capture and categorization, analytics limited to current month only, up to 2 active warranty/insurance reminders at a time
- **Premium tier** (monthly/annual subscription via RevenueCat): full historical analytics and trends, unlimited reminders, CSV/PDF export of bills
- Paywall triggers: viewing analytics beyond current month, adding a 3rd active reminder, tapping export

## 6. Non-functional requirements
- All financial data encrypted at rest (Supabase handles this at the infra level; ensure Storage buckets are private with signed URL access only, never public)
- Handle offline capture gracefully: if network is unavailable when capturing a bill, queue the image locally and process/parse once connectivity returns — never lose a captured bill
- Vision-LLM parsing must have a fallback: if extraction confidence is low or the API call fails, still save the raw image and let the user manually enter merchant/amount/date/category rather than blocking the save

## 7. Explicitly OUT of scope for v1 (do not build these — future phases)
- Gmail/email bill scanning
- POS-system integrations (Petpooja, Posist, etc.)
- Insurance claim automation or filing
- Price-drop alerts or warranty marketplace features
- Multi-user/family shared accounts

## 8. Definition of done for v1
A user can sign up with phone OTP, capture a bill via camera OR share-extension, see it auto-parsed and categorized, confirm/edit the extracted data, view it in their bill list, see it reflected in the current month's analytics, and — if it's a warranty/insurance bill
Get a reminder scheduled before expiry. Free vs. premium gating works end-to-end with a real RevenueCat sandbox subscription purchase.
