# Backend API validation guide

## Routes

### GET /api/admin/clients

Purpose:
- returns the current client list for the admin flow

Expected response:
- status 200
- JSON array of client objects

### POST /api/admin/clients

Purpose:
- create a client

Body shape:

```json
{
  "name": "Northwind Labs",
  "contactEmail": "ops@northwind.com",
  "assignedStaff": "Aisha Shah",
  "status": "active",
  "walletBalance": 250000
}
```

Expected response:
- status 201
- created object with generated id

### PATCH /api/admin/clients/:id/status

Purpose:
- activate or suspend a client

Body shape:

```json
{
  "status": "suspended"
}
```

Expected response:
- status 200
- updated client object

### PATCH /api/admin/clients/:id/staff

Purpose:
- assign a manager or staff owner

Body shape:

```json
{
  "assignedStaff": "Rahul S"
}
```

Expected response:
- status 200
- updated client object

## Validation rules

- missing or invalid values return 400
- unknown client id returns 404
- invalid status values are rejected
- role enforcement is required before production use

## Current status

The server route layer exists, but it is in-memory and not yet final persisted backend logic.
