# Plivex branded Supabase Auth email templates

These responsive HTML templates use Plivex's light/purple brand palette (#6D28D9, #5B21B6, #FFFFFF, #F8F7FC) and the official Plivex favicon.

## Templates

| File | Supabase Auth template |
| --- | --- |
| `confirm-signup.html` | Confirm signup |
| `reset-password.html` | Reset password |
| `magic-link.html` | Magic link |
| `invite-user.html` | Invite user |
| `change-email.html` | Change email address |

## Apply to Supabase

These files are source templates only; adding them to GitHub does **not** automatically change the live Supabase Auth email templates. In the Supabase Dashboard, open **Authentication → Email Templates**, choose each matching template, and paste the HTML into its body. Keep the subject line appropriate to each template. Confirm the project Site URL and allowed redirect URLs remain set to the official Plivex domain.

The templates preserve Supabase's `{{ .ConfirmationURL }}` variable for the secure action link. Test signup confirmation, password recovery, magic-link sign-in, invitations, and email change in a test account after applying them.

Supabase Auth email templates do not themselves change the sender address. Sender name/address and custom SMTP are configured separately in Auth SMTP settings. Do not put SMTP passwords or provider API keys in this repository.
