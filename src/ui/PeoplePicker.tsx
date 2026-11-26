import type { Uid } from '../model/types';

/**
 * Picks people for one list: the picked ones as removable chips, then an add menu of everyone
 * not picked and not disabled (say, picked in another list). The add menu is off when `full`.
 * `fixed` is a chip that is always there and cannot be removed (me, on my side).
 */
export function PeoplePicker(props: {
  label: string;
  options: Array<{ uid: Uid; name: string }>;
  selected: Uid[];
  disabled: Set<Uid>;
  full: boolean;
  fixed?: string;
  hint?: string;
  onChange(next: Uid[]): void;
}) {
  const { options, selected } = props;
  const nameOf = (uid: Uid) => options.find((o) => o.uid === uid)?.name ?? uid;
  const addable = options.filter((o) => !selected.includes(o.uid) && !props.disabled.has(o.uid));

  return (
    <div class="picker">
      <span class="picker-label">
        {props.label}
        {props.hint && <span class="hint"> {props.hint}</span>}
      </span>
      <div class="chips">
        {props.fixed && <span class="chip fixed">{props.fixed}</span>}
        {selected.map((uid) => (
          <span class="chip" key={uid}>
            {nameOf(uid)}
            <button
              type="button"
              class="chip-x"
              aria-label={`Remove ${nameOf(uid)}`}
              onClick={() => props.onChange(selected.filter((u) => u !== uid))}
            >
              ×
            </button>
          </span>
        ))}
        <select
          class="chip-add"
          aria-label={props.label}
          value=""
          disabled={props.full || addable.length === 0}
          onChange={(e) => {
            const el = e.target as HTMLSelectElement;
            const uid = el.value;
            el.value = '';
            if (uid) props.onChange([...selected, uid]);
          }}
        >
          <option value="">+ add</option>
          {addable.map((o) => (
            <option key={o.uid} value={o.uid}>{o.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
