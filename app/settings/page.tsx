import { configPath, syncSettings } from '@/lib/hartask/config';
import { listSettings, type SettingView } from '@/lib/hartask/settings';
import { listOrigins } from '@/lib/hartask/sync/identity';
import { saveSettingsAction, syncNowAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Configuración · Hartask' };

/**
 * An environment variable beats the file, so a value that is overridden would
 * save and appear to do nothing. The page says so next to the field rather
 * than letting the user discover it by being confused.
 */
function OverrideWarning({ override }: { override: NonNullable<SettingView['override']> }) {
  return (
    <p className="blocked small">
      <code>{override.name}</code> está definida como <code>{override.value}</code> y gana sobre el
      archivo. Lo que guardes aquí queda escrito, pero no tendrá efecto mientras esa variable siga
      puesta.
    </p>
  );
}

function ReadOnlyRow({ setting }: { setting: SettingView }) {
  return (
    <>
      <dt>{setting.label}</dt>
      <dd>
        <code>{String(setting.value)}</code>
        {setting.note ? <div className="muted small">{setting.note}</div> : null}
        {setting.override ? <OverrideWarning override={setting.override} /> : null}
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
  const readOnly = settings.filter((setting) => !setting.editable);
  const remote = syncSettings();
  const origins = listOrigins();

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
            {projectName.override ? <OverrideWarning override={projectName.override} /> : null}
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
            {threshold.override ? <OverrideWarning override={threshold.override} /> : null}
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
            {sync.override ? <OverrideWarning override={sync.override} /> : null}
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
            {token.override ? <OverrideWarning override={token.override} /> : null}
          </label>

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
