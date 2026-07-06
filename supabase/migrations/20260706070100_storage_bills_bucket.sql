-- Private storage bucket for bill images/PDFs.
-- Bills contain financial PII: the bucket is private and objects are only
-- ever accessed via short-lived signed URLs generated server-side, never a
-- public URL. Object paths follow the convention `${user_id}/${uuid}.<ext>`
-- so RLS can scope access to the owning user's folder.

insert into
  storage.buckets (id, name, public)
values
  ('bills', 'bills', false);

create policy "bill images are manageable by owner" on storage.objects for all using (
  bucket_id = 'bills'
  and auth.uid ()::text = (storage.foldername (name))[1]
)
with
  check (
    bucket_id = 'bills'
    and auth.uid ()::text = (storage.foldername (name))[1]
  );
