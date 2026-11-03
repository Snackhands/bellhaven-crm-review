import { forwardRef, type SelectHTMLAttributes } from "react";

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "multiple" | "size">;

/** Native single-choice dropdown. className styles the wrapper; ref targets the select. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className = "", children, ...props },
  ref,
) {
  return (
    <div className={`tr-select ${className}`.trim()}>
      <select {...props} ref={ref} className="tr-select-control">
        {children}
      </select>
      <svg className="tr-select-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
});

