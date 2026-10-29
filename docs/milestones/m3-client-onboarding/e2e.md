# End-to-end flow validation

## E2E path

1. User opens login page
2. User selects role and submits form
3. App routes to the correct page
4. Admin page loads client list from backend
5. User creates a client
6. Response is returned and the list refreshes
7. User toggles client status
8. User changes staff assignment
9. Final state is observed in the UI and confirmed by backend response

## Hard check for this milestone

The flow is only valid when the UI and backend match, with a real response from the server.

## Current status

This is still an in-progress prototype. The flow can be demonstrated in UI state and in-memory API response, but it is not complete without real auth, real persistence, and final validation.
