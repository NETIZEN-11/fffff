# Contributing to ResumeRank AI

Thank you for your interest in contributing.

## Development Setup

```bash
git clone https://github.com/yourname/resume-rank-ai.git
cd resume-rank-ai
npm install
cp .env.example .env.local
# Fill in .env.local
npm run db:migrate
npm run db:seed
npm run dev
```

## Branch Strategy

| Branch         | Purpose                            |
|----------------|------------------------------------|
| `main`         | Production-ready code              |
| `develop`      | Integration branch                 |
| `feature/*`    | New features                       |
| `fix/*`        | Bug fixes                          |
| `hotfix/*`     | Critical production fixes          |

## Commit Convention

```
feat: add skill comparison view
fix: correct ATS score calculation
refactor: extract analysis repository
test: add resume schema tests
docs: update deployment guide
chore: update dependencies
```

## Code Standards

- TypeScript strict mode — no `any`, no `ts-ignore`
- All new features need unit tests
- Business logic must live in services, never in components
- Run `npm run lint` and `npm run type-check` before committing
- Component files should be under 250 lines

## Pull Request Checklist

- [ ] Tests pass (`npm run test`)
- [ ] No TypeScript errors (`npm run type-check`)
- [ ] No ESLint warnings (`npm run lint`)
- [ ] New feature has unit tests
- [ ] UI changes are responsive and accessible
- [ ] No secrets in code

## Reporting Issues

Open an issue with:
1. What you expected
2. What happened
3. Steps to reproduce
4. Environment details
