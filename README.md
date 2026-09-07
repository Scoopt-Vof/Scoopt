# Scoopt

Two self-contained halves. Each has its own dependencies and is run from its own folder.

## frontend/
The Next.js website (Josh). Run it:
    cd frontend
    npm install
    npm run dev        ->  http://localhost:3000

## backend/
The API + data (Larry). Needs a database and a .env — see backend/README.md:
    cd backend
    npm install
    npm run db:migrate
    npm run serve      ->  http://localhost:3002

## Working together
- Pull before you start, push when you finish.
- Never hand-copy files into the repo folder; work inside your own half and let
  GitHub Desktop commit the changes. Each half's .gitignore keeps node_modules
  out of Git.
- The shared data shapes live in the contract; change those deliberately, together.
