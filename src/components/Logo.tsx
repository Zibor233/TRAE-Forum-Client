export default function TraeLogo({ className = '' }: { className?: string }) {
  return (
    <svg
      width="28"
      height="21"
      viewBox="0 0 28 21"
      fill="none"
      role="img"
      aria-label="TRAE"
      className={className}
    >
      <path
        fill="currentColor"
        d="M28.002 20.846H4v-3.998H0V.846h28.002zM4 16.848h20.002V4.845H4zm10.002-6.062-2.829 2.828-2.828-2.828 2.828-2.829zm8-.002-2.828 2.828-2.829-2.828 2.829-2.829z"
      />
    </svg>
  )
}
