import { useEffect, useState } from 'react';
import { getNotificationPlugins } from '../api';

// Generic notification-setup UI, shared between the join page (Lobby.jsx,
// where values feed into the create/join request body) and the in-room side
// panel (GameRoom.jsx, where they're saved separately via onSave). This
// component fetches the plugin list itself and renders a plain wrapper div
// with no layout styling of its own - the surrounding page supplies that via
// ".lobby-form .notify-settings" vs ".side-panel .notify-settings" (see
// App.css), so the same markup looks right in both places.
//
// `browserNotify` must come from a single useBrowserNotifications() call
// made once by the parent page - see that hook's comment for why.
export default function NotificationSettings({
  browserNotify,
  values,
  onChange,
  onSave,
  saving,
  saved,
}) {
  const [plugins, setPlugins] = useState([]);

  useEffect(() => {
    let cancelled = false;
    getNotificationPlugins()
      .then((data) => {
        if (!cancelled) setPlugins(data.plugins || []);
      })
      .catch(() => {
        // No plugin list available (offline, server hiccup) - just fall back
        // to showing nothing beyond the browser toggle below, rather than
        // breaking the join form or the room over it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The browser plugin is handled specially: its checkbox is wired straight
  // to useBrowserNotifications (immediate effect, no server round-trip and
  // no setup fields), so it's excluded from the generic setup-fields loop
  // below and rendered on its own first, matching the approved mockup.
  const otherPlugins = plugins.filter((p) => p.id !== 'browser' && p.setupFields.length > 0);

  if (!browserNotify?.supported && otherPlugins.length === 0) {
    return null;
  }

  function fieldValue(pluginId, key) {
    return values?.[pluginId]?.[key] ?? '';
  }

  function handleFieldChange(pluginId, key, value) {
    onChange?.(pluginId, key, value);
  }

  return (
    <div className="notify-settings">
      <div className="notify-settings-header">
        🔔 Notifications <span className="notify-settings-optional">(optional)</span>
      </div>
      <p className="hint notify-settings-hint">
        Get pinged when it's your turn. Leave any of these off or blank to skip them.
      </p>

      {browserNotify?.supported && (
        <label className="notify-field notify-field-checkbox">
          <span className="notify-field-checkbox-row">
            <input
              type="checkbox"
              checked={browserNotify.enabled}
              onChange={browserNotify.toggle}
            />
            Browser notifications
          </span>
          <span className="notify-field-hint">
            Pings this browser tab when it's your turn.
          </span>
          {browserNotify.permission === 'denied' && (
            <span className="notify-field-hint notify-field-warning">
              Notifications are blocked for this site — enable them in your browser's
              site settings to turn this on.
            </span>
          )}
        </label>
      )}

      {otherPlugins.map((plugin) => (
        <div key={plugin.id}>
          {plugin.setupFields.map((field) => (
            <label key={field.key} className="notify-field">
              {field.label}
              <input
                value={fieldValue(plugin.id, field.key)}
                onChange={(e) => handleFieldChange(plugin.id, field.key, e.target.value)}
                placeholder={field.placeholder}
              />
              <span className="notify-field-hint">{plugin.description}</span>
            </label>
          ))}
        </div>
      ))}

      {onSave && otherPlugins.length > 0 && (
        <button type="button" className="notify-save-btn" onClick={onSave} disabled={saving}>
          {saved ? 'Saved!' : 'Save'}
        </button>
      )}
    </div>
  );
}
