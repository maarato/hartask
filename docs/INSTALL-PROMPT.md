# Install prompt

What to hand the coding agent of a project that should get Hartask.

It is deliberately short. [`FIRST-RUN.md`](FIRST-RUN.md) already carries the
first run — what to ask before migrating anything, how to move an existing
`tasks.md`, how to finish properly — and [`SYNC.md`](SYNC.md) carries the store.
This prompt only covers the two things neither of them does, because both happen
before Hartask exists in the project:

- **cloning it into the project**, which `FIRST-RUN.md` assumes has happened;
- **the port**, which matters as soon as there is a second project. It is a
  real setting now: `hartask.config.json` decides it, `HARTASK_PORT` overrides
  it, and `npm run dev` resolves both before starting the server.

The prompt is in Spanish because that is the language of the boards it was
written for. Translate it freely; nothing in it depends on the wording.

---

```
Quiero instalar Hartask en este proyecto.

Hartask es un control plane local de continuidad y tareas para humanos y coding
agents. Vive como subcarpeta del repo que gestiona, corre en local sobre SQLite,
y te da un lugar donde dejar en qué te quedaste, qué falta y por qué, de forma
que la siguiente sesión (tuya o de otro agente) lo pueda retomar.

Pasos:

1. Clónalo dentro de este proyecto, en `hartask/`:

   git clone https://github.com/maarato/hartask.git hartask

   Clónalo — no copies la carpeta desde otro proyecto. Una copia se lleva
   `data/hartask.sqlite` y con él la identidad de sincronización de ese otro
   proyecto, y las dos instancias se creerían el mismo origen.

2. Agrega `hartask/` al `.gitignore` de este proyecto. El código viene de su
   propio repo y los datos se sincronizan aparte; no hay nada que versionar aquí.

3. Instala: `cd hartask && npm install`

4. Lee `hartask/docs/FIRST-RUN.md` completo y síguelo. Es la guía de primera vez
   y te dice qué preguntarme antes de actuar. En corto: **no migres tareas, no
   arranques el servidor y no sincronices sin preguntarme primero.**

5. Puerto: voy a tener varios proyectos con Hartask a la vez, así que este
   necesita el suyo. Ponlo en `hartask/hartask.config.json`:

   { "port": <PUERTO> }

   Después `npm run dev` arranca ahí solo. Pregúntame cuál usar si no te lo dije.

6. Sincronización con la base en la nube: crea `hartask/.env.local` con

   HARTASK_SYNC_URL=...
   HARTASK_SYNC_TOKEN=...

   Pídeme esos dos valores; no los inventes ni los copies de otro proyecto.
   **Deja `HARTASK_SYNC_PROJECT_ID` sin poner.** Esa variable es para que una
   segunda máquina se una a un proyecto que YA existe en la base; este es un
   proyecto nuevo, y ponerla metería este board dentro del alcance de otro.
   El detalle está en `hartask/docs/SYNC.md`.

   `.env.local` ya está en el `.gitignore` de Hartask. No lo commitees.

Para actualizar Hartask más adelante: `cd hartask && git pull`.

Cuando termines, dime en qué puerto quedó y qué encontraste en este proyecto que
valga la pena migrar al board.
```

---

## Ports

One per project, since they run at the same time: 43127, 43128, 43129, and so
on. It goes in `hartask.config.json`, which is the clone's own configuration
file and is not tracked, so `git pull` never has a change of yours to
reconcile. `HARTASK_PORT` in `.env.local` does the same for a one-off.

## What the prompt leaves out, on purpose

**The credentials.** The agent is told to ask for the URL and the token rather
than being handed them, so they are never pasted into a file that a prompt could
travel in.

**Permission to migrate or start.** `FIRST-RUN.md` already establishes that the
agent asks first, and a prompt that pre-authorised those would quietly override
it. The prompt points at that document instead of restating it.

**`HARTASK_SYNC_PROJECT_ID`.** Told to leave it empty, and told why: it is how a
*second machine* joins an existing project, and setting it on a genuinely new
project would write the board into another project's scope. Sync refuses that
and records `SYNC_REFUSED`, but a refusal the user does not understand is worse
than an instruction that avoids it.

## Keeping several installs current

`git pull` inside each `hartask/`. Four clones cost about 636 MB of
`node_modules` each, which is the price of not having a package yet: Hartask is
a Next.js app rather than a library, and it reads `lib/db/schema.sql` relative to
the working directory, so one install cannot serve several projects as it
stands.
