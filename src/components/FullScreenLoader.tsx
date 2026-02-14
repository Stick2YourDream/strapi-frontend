import "../css/loading.css";

type FullScreenLoaderProps = {
  label?: string;
};

export default function FullScreenLoader({ label = "Loading..." }: FullScreenLoaderProps) {
  return (
    <div className="fullscreen-loader" role="status" aria-live="polite" aria-label={label}>
      <div className="fullscreen-loader__brand" aria-hidden="true">
        <span className="fullscreen-loader__orbit" />
        <img src="/logo2.png" alt="" loading="eager" decoding="async" />
      </div>
      <span className="fullscreen-loader__text">{label}</span>
    </div>
  );
}
