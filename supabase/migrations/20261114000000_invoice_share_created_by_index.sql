-- Cover the created_by foreign key used for cascade cleanup and owner listing.
-- The index is additive and safe to reapply.
CREATE INDEX IF NOT EXISTS invoice_share_links_created_by_idx
  ON public.invoice_share_links(created_by);
