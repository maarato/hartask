import { configPath, syncSettings } from '@/lib/hartask/config';
import { listSettings, type SettingView } from '@/lib/hartask/settings';
import { ensureProject } from '@/lib/hartask/repositories/projects';
import { listOrigins } from '@/lib/hartask/sync/identity';
import { lastSync, type LastSync } from '@/lib/hartask/sync/run';
import { saveSettingsAction, syncNowAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Configuración · Hartask' };

/**
 * An environment variable beats the file, so a value that is overridden would
 * save and appear to do nothing. The page still says so, because silently
 * ignoring what someone typed is worse than a note — but it says it quietly
 * and without echoing the value back: this page renders a sync token, and a
 * value printed to be helpful is a value that leaks.
 */
function OverrideNote({ override }: { override: NonNullable<SettingView['override']> }) {
  return (
    <span className="muted small">
      Viene de <code>{override.name}</code>. Lo que guardes aquí queda escrito, pero no tendrá
      efecto mientras esa variable siga puesta.
    </span>
  );
}

/**
 * What the last sync did.
 *
 * A refusal is the guard doing its job — it stops this board from being folded
 * into another project — so it reads as a instruction with a way out, not as a
 * breakage. A transport failure is the opposite: nothing here is wrong, the
 * other side could not be reached.
 */
function LastSyncNotice({ outcome }: { outcome: LastSync }) {
  if (outcome.kind === 'completed') {
    return (
      <p className="muted small">
        Última sincronización: {outcome.at}
      </p>
    );
  }

  const configured = (outcome.detail as { configured?: string } | null)?.configured;

  return (
    <div className="card notice stack">
      <span>
        <strong>
          {outcome.kind === 'refused'
            ? 'La sincronización se detuvo sola'
            : 'No se pudo sincronizar'}
        </strong>
        <div className="muted small">{outcome.at}</div>
      </span>

      {outcome.kind === 'refused' ? (
        <span>
          El id de proyecto configurado
          {configured ? (
            <>
              {' '}
              (<code>{configured}</code>)
            </>
          ) : null}{' '}
          es de otro board, y este ya tiene tasks propias. Seguir habría fundido los dos
          en un solo proyecto, y ninguna sincronización posterior los puede separar.
          <div className="muted small">
            Si este es un proyecto nuevo, quita <code>HARTASK_SYNC_PROJECT_ID</code>: esa
            variable es solo para una segunda máquina que se une a un proyecto que ya
            existe en el almacén. Si de verdad quieres mover este board, sincroniza una
            vez con <code>{'{"action":"sync","adopt_project":true}'}</code> contra{' '}
            <code>POST /api/sync</code>. El detalle está en <code>docs/SYNC.md</code>.
          </div>
        </span>
      ) : (
        <span>
          {outcome.summary}
          <div className="muted small">
            No hay nada mal en este board: no se pudo llegar al otro lado. Revisa la URL,
            el secreto y la conexión, y vuelve a intentarlo.
          </div>
        </span>
      )}
    </div>
  );
}

function ReadOnlyRow({ setting }: { setting: SettingView }) {
  return (
    <>
      <dt>{setting.label}</dt>
      <dd>
        <code>{String(setting.value)}</code>
        {setting.note ? <div className="muted small">{setting.note}</div> : null}
        {setting.override ? <OverrideNote override={setting.override} /> : null}
      </dd>
    </>
  );
}

export default function SettingsPage() {
  const settings = listSettings();
  const byKey = new Map(settings.map((setting) => [setting.key, setting]));
  const projectName = byKey.get('projectName')!;
  const threshold = byKey.get('archiveReminderThreshold')!;
  const sync = byKey.get('syncUrl')!;
  const token = byKey.get('syncToken')!;
  const autoArchive = byKey.get('autoArchive')!;
  const projectId = byKey.get('syncProjectId')!;
  const readOnly = settings.filter((setting) => !setting.editable);
  const remote = syncSettings();
  const origins = listOrigins();
  const project = ensureProject();
  const syncState = lastSync();
  // Empty on the original machine, which syncs under the project's own uuid.
  const joinedProjectId = String(projectId.value ?? '');
  const effectiveProjectId = joinedProjectId || project.uuid;

  return (
    <section className="stack sections">
      <h1>Configuración</h1>

      <article className="card stack">
        <header className="section-head">
          <h2>Ajustes</h2>
          <p className="muted small">Cambios que tienen efecto de inmediato.</p>
        </header>

        <form action={saveSettingsAction} className="stack form">
          <label className="stack field">
            <span>{projectName.label}</span>
            <input name="projectName" defaultValue={String(projectName.value)} required />
            {projectName.override ? <OverrideNote override={projectName.override} /> : null}
          </label>

          <label className="stack field">
            <span>{threshold.label}</span>
            <input
              name="archiveReminderThreshold"
              type="number"
              min={0}
              defaultValue={String(threshold.value)}
              required
            />
            <span className="muted small">
              El board avisa cuando las tasks archivables raíz superan este número.
            </span>
            {threshold.override ? <OverrideNote override={threshold.override} /> : null}
          </label>

          <label className="row checkbox">
            {/* An unchecked box sends nothing, so a marker says the form did
                include the field and the absence is a real "off". */}
            <input type="hidden" name="autoArchiveSubmitted" value="1" />
            <input type="checkbox" name="autoArchive" defaultChecked={autoArchive.value === true} />
            <span>
              {autoArchive.label}
              <div className="muted small">
                Al pasar el umbral se archivan solas, sin preguntar. Quedan en{' '}
                <em>Archivadas</em> y los eventos las atribuyen a{' '}
                <code>auto-archive</code>.
              </div>
            </span>
            {autoArchive.override ? <OverrideNote override={autoArchive.override} /> : null}
          </label>

          <label className="stack field">
            <span>{sync.label}</span>
            <input
              name="syncUrl"
              type="url"
              defaultValue={String(sync.value)}
              placeholder="https://hartask.example.com"
            />
            <span className="muted small">
              El remoto es otra instancia de Hartask, no una base suelta.
            </span>
            {sync.override ? <OverrideNote override={sync.override} /> : null}
          </label>

          <label className="stack field">
            <span>{token.label}</span>
            <input
              name="syncToken"
              type="password"
              placeholder={
                remote.token ? 'Configurado — escribe uno nuevo para reemplazarlo' : 'Sin configurar'
              }
              autoComplete="new-password"
            />
            <span className="muted small">
              Ambos lados deben usar el mismo secreto. Sin él la sincronización queda cerrada. No se
              muestra nunca; dejarlo vacío conserva el actual.
            </span>
            {token.override ? <OverrideNote override={token.override} /> : null}
          </label>

          {/* The id this instance syncs under is a fact worth reading, so it
              shows as a value rather than as a ghost placeholder that looked
              like one. Editing is behind a disclosure, open when nothing is
              configured yet — that is the case where the field is the point. */}
          <div className="stack field">
            <span>{projectId.label}</span>
            <code>{effectiveProjectId}</code>
            <span className="muted small">
              {joinedProjectId
                ? 'Esta máquina se une a un proyecto que ya existe en el almacén.'
                : 'Es el id propio de este proyecto, con el que se sincroniza. Déjalo así en la máquina original; en una segunda máquina, pega aquí el id del proyecto para unirte al que ya existe en el almacén.'}
            </span>
            {projectId.override ? <OverrideNote override={projectId.override} /> : null}
            <details open={!effectiveProjectId}>
              <summary>Editar</summary>
              <input
                name="syncProjectId"
                defaultValue={joinedProjectId}
                placeholder="Id del proyecto en el almacén"
              />
            </details>
          </div>

          <button type="submit">Guardar</button>
        </form>
      </article>

      <article className="card stack">
        <header className="section-head">
          <h2>Sincronización</h2>
          <p className="muted small">
            {remote.url && remote.token
              ? `Lista contra ${remote.url}`
              : 'Falta la URL o el secreto.'}
          </p>
        </header>

        <dl className="handoff">
          <dt>Id de este proyecto</dt>
          <dd>
            <code>{project.uuid}</code>
            <div className="muted small">
              Cópialo en la otra máquina para que sincronice contra este mismo proyecto.
            </div>
          </dd>
          {origins.map((origin) => (
            <div key={origin.id} style={{ display: 'contents' }}>
              <dt>{origin.is_local ? 'Este origen' : origin.label}</dt>
              <dd>
                reloj {origin.lamport} · ids{' '}
                <code>TASK-{origin.public_id_prefix}NNN</code>
              </dd>
            </div>
          ))}
        </dl>

        {syncState ? <LastSyncNotice outcome={syncState} /> : null}

        {remote.url && remote.token ? (
          <form action={syncNowAction}>
            <button type="submit">Sincronizar ahora</button>
          </form>
        ) : null}
      </article>

      <article className="card stack">
        <header className="section-head">
          <h2>Solo lectura</h2>
          <p className="muted small">Se leen al arrancar el proceso.</p>
        </header>
        <dl className="handoff">
          {readOnly.map((setting) => (
            <ReadOnlyRow key={setting.key} setting={setting} />
          ))}
        </dl>
      </article>

      <article className="card stack">
        <header className="section-head">
          <h2>Dónde se guarda</h2>
        </header>
        <p>
          Los ajustes se escriben en <code>{configPath()}</code>.
        </p>
        <p className="muted">
          El orden de resolución es variable de entorno, luego el archivo, luego los valores por
          defecto. Un agente puede leerlos con <code>GET /api/settings</code>.
        </p>
      </article>
    </section>
  );
}
