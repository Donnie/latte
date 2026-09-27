import styles from "./ToggleSwitch.module.css";

interface ToggleSwitchProps {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}

export default function ToggleSwitch({ label, checked, onChange }: ToggleSwitchProps) {
  return (
    <label className={checked ? `${styles.switch} ${styles.on}` : styles.switch}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.track}>
        <span className={styles.knob} />
      </span>
      <span className={styles.label}>{label}</span>
    </label>
  );
}
