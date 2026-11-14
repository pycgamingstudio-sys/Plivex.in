CREATE OR REPLACE FUNCTION public.has_ws_role(_ws text, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND workspace_id = _ws AND role = ANY(_roles)) $$;
REVOKE EXECUTE ON FUNCTION public.has_ws_role(text, public.app_role[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_ws_role(text, public.app_role[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ist_today() RETURNS date LANGUAGE sql STABLE SET search_path = public AS
$$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

-- Invoices
CREATE TABLE public.invoice_counters (
  workspace_id text PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0
);
GRANT ALL ON public.invoice_counters TO service_role;
ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  created_by uuid,
  number text NOT NULL,
  client_name text,
  client_email text,
  business_name text,
  issue_date date NOT NULL DEFAULT public.ist_today(),
  due_date date,
  currency text NOT NULL DEFAULT 'INR',
  tax_mode text NOT NULL DEFAULT 'split' CHECK (tax_mode IN ('split','igst')),
  tax_rate numeric NOT NULL DEFAULT 0,
  discount_type text NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent','flat')),
  discount numeric NOT NULL DEFAULT 0,
  notes text,
  terms text,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Paid','Cancelled')),
  is_draft boolean NOT NULL DEFAULT false,
  subtotal numeric NOT NULL DEFAULT 0,
  tax_value numeric NOT NULL DEFAULT 0,
  cgst numeric NOT NULL DEFAULT 0,
  sgst numeric NOT NULL DEFAULT 0,
  igst numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  stock_applied boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, number)
);
CREATE INDEX ON public.invoices (workspace_id, issue_date);
GRANT SELECT ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices read" ON public.invoices FOR SELECT TO authenticated
  USING (public.has_ws_role(workspace_id, ARRAY['admin','manager','employee','accountant']::public.app_role[]));
CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description text NOT NULL DEFAULT '',
  quantity numeric NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  gst_rate numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.invoice_items (invoice_id);
GRANT SELECT ON public.invoice_items TO authenticated;
GRANT ALL ON public.invoice_items TO service_role;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice items read" ON public.invoice_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id
    AND public.has_ws_role(i.workspace_id, ARRAY['admin','manager','employee','accountant']::public.app_role[])));

CREATE OR REPLACE FUNCTION public.next_invoice_number(_ws text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.invoice_counters (workspace_id, last_number) VALUES (_ws, 1)
  ON CONFLICT (workspace_id) DO UPDATE SET last_number = public.invoice_counters.last_number + 1
  RETURNING last_number INTO n;
  RETURN 'INV-' || lpad(n::text, 3, '0');
END $$;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(text) TO service_role;

-- Stock
CREATE TABLE public.stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  name text NOT NULL,
  sku text,
  quantity numeric NOT NULL DEFAULT 0,
  unit text,
  price numeric NOT NULL DEFAULT 0,
  low_stock numeric NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.stock (workspace_id, lower(name));

CREATE OR REPLACE FUNCTION public.apply_invoice_stock(_invoice uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ws text;
BEGIN
  UPDATE public.invoices SET stock_applied = true
   WHERE id = _invoice AND NOT stock_applied AND NOT is_draft AND status <> 'Cancelled'
   RETURNING workspace_id INTO ws;
  IF ws IS NULL THEN RETURN false; END IF;
  UPDATE public.stock s SET quantity = greatest(0, s.quantity - x.qty)
    FROM (SELECT lower(trim(description)) AS d, sum(greatest(0, quantity)) AS qty
            FROM public.invoice_items WHERE invoice_id = _invoice GROUP BY 1) x
   WHERE s.workspace_id = ws AND lower(trim(s.name)) = x.d;
  RETURN true;
END $$;
REVOKE EXECUTE ON FUNCTION public.apply_invoice_stock(uuid) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.apply_invoice_stock(uuid) TO service_role;

-- Other tables
CREATE TABLE public.quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  number text,
  client_name text,
  date date NOT NULL DEFAULT public.ist_today(),
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('sent','draft')),
  tax_rate numeric NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  name text NOT NULL,
  company text, email text, phone text, gstin text, address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  vendor text,
  category text NOT NULL DEFAULT 'Other' CHECK (category IN ('Rent','Raw Materials','Utilities','Salary','Logistics','Software','Marketing','Other')),
  amount numeric NOT NULL DEFAULT 0,
  date date NOT NULL DEFAULT public.ist_today(),
  status text, method text, notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  name text NOT NULL,
  rate numeric NOT NULL DEFAULT 0,
  gst_rate numeric NOT NULL DEFAULT 0,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  name text NOT NULL,
  phone text, requirement text,
  value numeric NOT NULL DEFAULT 0,
  stage text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.business_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL UNIQUE,
  name text, email text, phone text, gstin text, address text, logo_url text, upi_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotations, public.clients, public.expenses, public.stock, public.services, public.leads, public.business_profile TO authenticated;
GRANT ALL ON public.quotations, public.clients, public.expenses, public.stock, public.services, public.leads, public.business_profile TO service_role;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_profile ENABLE ROW LEVEL SECURITY;

-- quotations: admin, manager, employee full
CREATE POLICY "quotations rw" ON public.quotations FOR ALL TO authenticated
  USING (public.has_ws_role(workspace_id, ARRAY['admin','manager','employee']::public.app_role[]))
  WITH CHECK (public.has_ws_role(workspace_id, ARRAY['admin','manager','employee']::public.app_role[]));
-- clients & leads: read admin/manager/employee, write admin/manager
CREATE POLICY "clients read" ON public.clients FOR SELECT TO authenticated
  USING (public.has_ws_role(workspace_id, ARRAY['admin','manager','employee']::public.app_role[]));
CREATE POLICY "clients insert" ON public.clients FOR INSERT TO authenticated WITH CHECK (public.has_ws_role(workspace_id, ARRAY['admin','manager']::public.app_role[]));
CREATE POLICY "clients update" ON public.clients FOR UPDATE TO authenticated USING (public.has_ws_role(workspace_id, ARRAY['admin','manager']::public.app_role[])) WITH CHECK (public.has_ws_role(workspace_id, ARRAY['admin','manager']::public.app_role[]));
CREATE POLICY "clients delete" ON public.clients FOR DELETE TO authenticated USING (public.has_ws_role(workspace_id, ARRAY['admin','manager']::public.app_role[]));
CREATE POLICY "leads read" ON public.leads FOR SELECT TO authenticated
  USING (public.has_ws_role(workspace_id, ARRAY['admin','manager','employee']::public.app_role[]));
CREATE POLICY "leads insert" ON public.leads FOR INSERT TO authenticated WITH CHECK (public.has_ws_role(workspace_id, ARRAY['admin','manager']::public.app_role[]));
CREATE POLICY "leads update" ON public.leads FOR UPDATE TO authenticated USING (public.has_ws_role(workspace_id, ARRAY['admin','manager']::public.app_role[])) WITH CHECK (public.has_ws_role(workspace_id, ARRAY['admin','manager']::public.app_role[]));
CREATE POLICY "leads delete" ON public.leads FOR DELETE TO authenticated USING (public.has_ws_role(workspace_id, ARRAY['admin','manager']::public.app_role[]));
-- expenses: read admin/manager/accountant, write admin/manager
CREATE POLICY "expenses read" ON public.expenses FOR SELECT TO authenticated
  USING (public.has_ws_role(workspace_id, ARRAY['admin','manager','accountant']::public.app_role[]));
CREATE POLICY "expenses insert" ON public.expenses FOR INSERT TO authenticated WITH CHECK (public.has_ws_role(workspace_id, ARRAY['admin','manager']::public.app_role[]));
CREATE POLICY "expenses update" ON public.expenses FOR UPDATE TO authenticated USING (public.has_ws_role(workspace_id, ARRAY['admin','manager']::public.app_role[])) WITH CHECK (public.has_ws_role(workspace_id, ARRAY['admin','manager']::public.app_role[]));
CREATE POLICY "expenses delete" ON public.expenses FOR DELETE TO authenticated USING (public.has_ws_role(workspace_id, ARRAY['admin','manager']::public.app_role[]));
-- stock: admin/manager/storekeeper full
CREATE POLICY "stock rw" ON public.stock FOR ALL TO authenticated
  USING (public.has_ws_role(workspace_id, ARRAY['admin','manager','storekeeper']::public.app_role[]))
  WITH CHECK (public.has_ws_role(workspace_id, ARRAY['admin','manager','storekeeper']::public.app_role[]));
-- services: admin/manager full
CREATE POLICY "services rw" ON public.services FOR ALL TO authenticated
  USING (public.has_ws_role(workspace_id, ARRAY['admin','manager']::public.app_role[]))
  WITH CHECK (public.has_ws_role(workspace_id, ARRAY['admin','manager']::public.app_role[]));
-- business_profile: read whole workspace, write admin
CREATE POLICY "bp read" ON public.business_profile FOR SELECT TO authenticated
  USING (public.has_ws_role(workspace_id, ARRAY['admin','manager','employee','storekeeper','accountant']::public.app_role[]));
CREATE POLICY "bp insert" ON public.business_profile FOR INSERT TO authenticated WITH CHECK (public.has_ws_role(workspace_id, ARRAY['admin']::public.app_role[]));
CREATE POLICY "bp update" ON public.business_profile FOR UPDATE TO authenticated USING (public.has_ws_role(workspace_id, ARRAY['admin']::public.app_role[])) WITH CHECK (public.has_ws_role(workspace_id, ARRAY['admin']::public.app_role[]));

CREATE INDEX ON public.quotations (workspace_id);
CREATE INDEX ON public.clients (workspace_id);
CREATE INDEX ON public.expenses (workspace_id, date);
CREATE INDEX ON public.services (workspace_id);
CREATE INDEX ON public.leads (workspace_id);

CREATE TRIGGER quotations_updated_at BEFORE UPDATE ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER expenses_updated_at BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER stock_updated_at BEFORE UPDATE ON public.stock FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER services_updated_at BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER business_profile_updated_at BEFORE UPDATE ON public.business_profile FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Logo storage (bucket "logos", path: <workspace_id>/<file>)
CREATE POLICY "logos read workspace" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'logos' AND public.has_ws_role((storage.foldername(name))[1], ARRAY['admin','manager','employee','storekeeper','accountant']::public.app_role[]));
CREATE POLICY "logos admin insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'logos' AND public.has_ws_role((storage.foldername(name))[1], ARRAY['admin']::public.app_role[]));
CREATE POLICY "logos admin update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'logos' AND public.has_ws_role((storage.foldername(name))[1], ARRAY['admin']::public.app_role[]));
CREATE POLICY "logos admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'logos' AND public.has_ws_role((storage.foldername(name))[1], ARRAY['admin']::public.app_role[]));
