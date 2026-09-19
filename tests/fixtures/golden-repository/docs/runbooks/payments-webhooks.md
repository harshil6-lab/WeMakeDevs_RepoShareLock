# Runbook: payment webhook deliveries

## Symptom

Payment provider webhook deliveries intermittently fail with a request timeout.
Failures cluster during provider slow periods and are reported as HTTP 504 by the
edge proxy.

## Known behaviour

- The provider retries every delivery that is not acknowledged within 10 seconds.
- Provider charge requests occasionally take longer than 10 seconds under load.
- Retried deliveries can arrive more than once for the same event.

## Escalation

If webhook timeouts continue after the provider recovers, page the payments
on-call engineer and attach the affected event ids.
