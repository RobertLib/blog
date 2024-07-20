import cn from "../../utils/cn";

export default function Button({
  children,
  className,
  disabled = false,
  loading = false,
  size = "md",
  style = {},
  type = "button",
  variant = "primary",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
  Readonly<{
    loading?: boolean;
    size?: "sm" | "md" | "lg";
    variant?: "primary" | "danger" | "warning" | "default" | "link" | "icon";
  }>) {
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex items-center justify-center rounded-md border border-transparent font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2",
        variant === "primary" &&
          "bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500",
        variant === "danger" &&
          "bg-danger-600 text-white hover:bg-danger-700 focus:ring-danger-500",
        variant === "warning" &&
          "bg-warning-600 text-white hover:bg-warning-700 focus:ring-warning-500",
        variant === "default" && "bg-gray-100 text-gray-700",
        variant === "link" && "bg-transparent text-primary-600",
        variant === "icon" && "bg-gray-100 text-gray-700",
        size === "sm" && "px-2 py-1 text-sm",
        size === "md" && "px-4 py-2 text-base",
        size === "lg" && "px-6 py-3 text-lg",
        loading && "cursor-wait",
        className,
      )}
      disabled={disabled}
      style={{ ...style, opacity: disabled ? 0.5 : 1 }}
      type={type}
    >
      {loading && (
        <svg
          className="-ml-1 mr-3 h-5 w-5 animate-spin text-white"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      )}
      {children}
    </button>
  );
}
