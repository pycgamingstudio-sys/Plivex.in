-- Disposable integration assertions for the Main Workspace OCR worker RPCs.
-- Run only in the isolated migration-replay database.
DO $ocr_worker_privileges$
DECLARE
  fn text;
  signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.claim_document_ocr_job(uuid)',
    'public.claim_document_ocr_jobs(integer)',
    'public.complete_document_ocr_job(uuid,jsonb,text)',
    'public.fail_document_ocr_job(uuid,text)'
  ] LOOP
    IF has_function_privilege('anon', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can execute OCR worker RPC %', signature;
    END IF;
    IF has_function_privilege('authenticated', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated can execute OCR worker RPC %', signature;
    END IF;
    IF NOT has_function_privilege('service_role', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot execute OCR worker RPC %', signature;
    END IF;
  END LOOP;

  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  BEGIN
    PERFORM public.claim_document_ocr_jobs(0);
    RAISE EXCEPTION 'OCR batch size validation did not reject zero';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
  BEGIN
    PERFORM public.claim_document_ocr_job('00000000-0000-4000-8000-000000000001'::uuid);
    RAISE EXCEPTION 'OCR single-job claim unexpectedly found a missing job';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    NULL;
  END;
  BEGIN
    PERFORM public.complete_document_ocr_job('00000000-0000-4000-8000-000000000001'::uuid, NULL, 'test-model');
    RAISE EXCEPTION 'OCR completion accepted a null extraction payload';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
  BEGIN
    PERFORM public.fail_document_ocr_job('00000000-0000-4000-8000-000000000001'::uuid, NULL);
    RAISE EXCEPTION 'OCR failure accepted an empty error code';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM public.claim_document_ocr_jobs(1);
    RAISE EXCEPTION 'authenticated JWT passed OCR worker authorization';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;
  BEGIN
    PERFORM public.claim_document_ocr_job('00000000-0000-4000-8000-000000000001'::uuid);
    RAISE EXCEPTION 'authenticated JWT passed OCR single-job authorization';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;
  BEGIN
    PERFORM public.complete_document_ocr_job('00000000-0000-4000-8000-000000000001'::uuid, '{}'::jsonb, 'test-model');
    RAISE EXCEPTION 'authenticated JWT passed OCR completion authorization';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;
  BEGIN
    PERFORM public.fail_document_ocr_job('00000000-0000-4000-8000-000000000001'::uuid, 'test-error');
    RAISE EXCEPTION 'authenticated JWT passed OCR failure authorization';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;
END
$ocr_worker_privileges$;
