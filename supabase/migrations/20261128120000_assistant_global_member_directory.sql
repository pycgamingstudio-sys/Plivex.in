-- Owner/admin-only Main Workspace member directory for assistant permission controls.
CREATE OR REPLACE FUNCTION public.assistant_list_global_members(
  p_workspace_id uuid,
  p_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog','global'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_members jsonb;
  v_limit integer := greatest(1,least(coalesce(p_limit,100),100));
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_workspace_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM global.workspace_members
    WHERE workspace_id=p_workspace_id AND user_id=v_user_id
      AND status='active' AND role IN ('owner','admin')
  ) THEN RAISE EXCEPTION 'PERMISSION_DENIED:member_list'; END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id',wm.id,'user_id',wm.user_id,'email',u.email,'role',wm.role,
      'status',wm.status,'created_at',wm.created_at,
      'permission_overrides',coalesce((
        SELECT jsonb_agg(jsonb_build_object('permission_key',po.permission_key,'effect',po.effect)
          ORDER BY po.permission_key)
        FROM global.workspace_permission_overrides po
        WHERE po.workspace_id=wm.workspace_id AND po.member_id=wm.id
      ),'[]'::jsonb)
    ) ORDER BY wm.created_at
  ),'[]'::jsonb)
  INTO v_members
  FROM (
    SELECT * FROM global.workspace_members
    WHERE workspace_id=p_workspace_id AND status='active'
    ORDER BY created_at LIMIT v_limit
  ) wm
  LEFT JOIN auth.users u ON u.id=wm.user_id;

  RETURN jsonb_build_object('ok',true,'members',v_members,'limit',v_limit);
END;
$function$;

REVOKE ALL ON FUNCTION public.assistant_list_global_members(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assistant_list_global_members(uuid,integer) TO authenticated;
