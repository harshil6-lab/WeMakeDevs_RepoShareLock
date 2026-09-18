1. Use camelCase for variables, functions, API JSON fields and frontend identifiers.

2. Use PascalCase for React components and Python classes where applicable.

3. Use clear snake_case only where required by external ecosystem conventions,
   AWS resources, database attributes, or Python tooling.

4. Every non-obvious function/module must contain useful comments.

5. Comments explain WHY, not obvious WHAT.

6. No giant functions.

7. Keep modules small and independently testable.

8. Type everything possible.

9. Validate external input at boundaries.

10. Never hardcode secrets.

11. Never log GitHub tokens.

12. Never expose AWS credentials.

13. Never fabricate GitHub data.

14. Never fabricate evidence.

15. Every investigation claim must reference evidence.

16. Agent tool calls must have hard limits.

17. Never allow an agent infinite loop.

18. Every API endpoint must have request/response validation.

19. Every AWS resource must be reproducible through IaC.

20. Local development must work without production credentials
   wherever practical.

21. Frontend must initially work against mock/API-compatible data.

22. Do not introduce new infrastructure unless necessary.

23. Prefer the existing architecture over introducing new services.

24. Every completed phase must update:
   implementation.md
   flow.md
   decision.md
   manual-setup.md

25. Every major completed packet gets committed.

26. Do not refactor unrelated code during implementation.

27. Do not overwrite the UI design unless integration requires it.

28. No Lovable branding anywhere.

29. No unnecessary dependencies.

30. Optimize for a working deployed hackathon product,
   not enterprise-scale architecture.