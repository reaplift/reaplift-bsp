# Frontend demo and validation guide

## Page: Login

### Flow

1. Open the app at http://localhost:5173
2. Select a role in the login form
3. Submit the form
4. Verify the user is routed to the correct page

### Expected result

- super admin goes to the admin page
- client admin or staff go to the dashboard flow
- invalid or missing authentication should reject access in a real auth version

### Current status

- demo state only
- no backend authentication is yet connected
- page state is local to React and not persisted

## Page: Admin

### Flow

1. Log in as super admin
2. Open the admin panel
3. Click Add client
4. Fill in name, contact email, assigned staff, wallet balance, status
5. Save the client
6. Confirm the list refreshes
7. Toggle active/suspended status
8. Click Change beside the assigned staff value to update staff

### Expected result

- list updates immediately in the UI
- new client appears at the top
- status changes reflect the selected value
- staff assignment changes reflect the selected value

### Current status

- demo/prototype in state
- not yet backed by a real auth session or database layer

## Frontend validation checklist

- page opens without crash
- form can be submitted
- list updates in the same session
- role gating matches access logic
- no hidden fake success path is used as proof of completion
