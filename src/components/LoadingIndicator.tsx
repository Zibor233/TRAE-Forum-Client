/** Small alternating squares, shared by page, image and pagination loading. */
export default function LoadingIndicator({ label, className = '' }: { label?: string; className?: string }) {
  return <span className={`loading-squares ${className}`} role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <span /><span />
  </span>
}
