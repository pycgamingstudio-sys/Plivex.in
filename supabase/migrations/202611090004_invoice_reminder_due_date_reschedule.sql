create or replace function public.reschedule_invoice_reminders_on_due_date_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_version integer;
  recipient text;
  today_date date := (now() at time zone 'utc')::date;
begin
  if old.due_date is not distinct from new.due_date then
    return new;
  end if;

  if not coalesce(new.reminder_enabled, false)
     or lower(coalesce(new.status, '')) in ('paid', 'cancelled')
     or coalesce(new.is_draft, false)
     or new.due_date is null then
    update public.invoice_reminder_events
       set status = 'cancelled', updated_at = now()
     where invoice_id = new.id
       and workspace_id = new.workspace_id
       and status in ('scheduled', 'on_hold', 'failed');
    if new.due_date is null and coalesce(new.reminder_enabled, false) then
      update public.invoices
         set reminder_enabled = false,
             reminder_schedule_version = coalesce(reminder_schedule_version, 1) + 1,
             updated_at = now()
       where id = new.id;
    end if;
    return new;
  end if;

  select coalesce(
    (select recipient_email
       from public.invoice_reminder_events
      where invoice_id = new.id
        and workspace_id = new.workspace_id
      order by created_at desc
      limit 1),
    new.client_email
  ) into recipient;

  if coalesce(trim(recipient), '') = '' then
    update public.invoice_reminder_events
       set status = 'cancelled', updated_at = now()
     where invoice_id = new.id
       and workspace_id = new.workspace_id
       and status in ('scheduled', 'on_hold', 'failed');
    return new;
  end if;

  next_version := coalesce(new.reminder_schedule_version, 1) + 1;

  update public.invoices
     set reminder_schedule_version = next_version,
         reminder_hold = false,
         updated_at = now()
   where id = new.id;

  update public.invoice_reminder_events
     set status = 'cancelled', updated_at = now()
   where invoice_id = new.id
     and workspace_id = new.workspace_id
     and status in ('scheduled', 'on_hold', 'failed');

  insert into public.invoice_reminder_events
    (workspace_id, invoice_id, schedule_version, stage, scheduled_for, status, recipient_email)
  values
    (new.workspace_id, new.id, next_version, 'before_due_2', new.due_date - 2,
      case when new.due_date - 2 < today_date then 'cancelled' else 'scheduled' end, lower(trim(recipient))),
    (new.workspace_id, new.id, next_version, 'due_date', new.due_date,
      case when new.due_date < today_date then 'cancelled' else 'scheduled' end, lower(trim(recipient))),
    (new.workspace_id, new.id, next_version, 'overdue_3', new.due_date + 3,
      case when new.due_date + 3 < today_date then 'cancelled' else 'scheduled' end, lower(trim(recipient))),
    (new.workspace_id, new.id, next_version, 'overdue_7', new.due_date + 7,
      case when new.due_date + 7 < today_date then 'cancelled' else 'scheduled' end, lower(trim(recipient))),
    (new.workspace_id, new.id, next_version, 'overdue_15', new.due_date + 15,
      case when new.due_date + 15 < today_date then 'cancelled' else 'scheduled' end, lower(trim(recipient)));

  if new.due_date + 15 < today_date then
    update public.invoice_reminder_events
       set scheduled_for = today_date, status = 'scheduled', updated_at = now()
     where invoice_id = new.id
       and workspace_id = new.workspace_id
       and schedule_version = next_version
       and stage = 'overdue_15';
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_reschedule_reminders_on_due_date on public.invoices;
create trigger invoices_reschedule_reminders_on_due_date
after update of due_date on public.invoices
for each row
when (old.due_date is distinct from new.due_date)
execute function public.reschedule_invoice_reminders_on_due_date_change();

revoke all on function public.reschedule_invoice_reminders_on_due_date_change() from public, anon, authenticated;
