import type { ReactNode } from "react";

export function Icon({ children, className = "", viewBox = "0 0 24 24" }: { children: ReactNode; className?: string; viewBox?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox={viewBox} xmlns="http://www.w3.org/2000/svg">
      {children}
    </svg>
  );
}

export function HealtripLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-lockup" aria-label="Healtrip plus">
      <div className="brand-mark">
        <svg aria-hidden="true" fill="none" viewBox="0 0 54 38" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M25.9 20.4c-4.6-7.5-8.4-10.8-13.2-10.8C6.8 9.6 3 14 3 19s3.8 9.4 9.7 9.4c5 0 9.6-4.2 14.3-9.7 4.5-5.3 8.8-9.1 13.5-9.1 5.9 0 9.8 4.4 9.8 9.4s-3.9 9.4-9.8 9.4c-4.8 0-8.4-3.1-13-10.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="4.6"
          />
          <g className="logo-plane">
            <path d="m41.3 8.3 7.8-5.2c.7-.5 1.7-.4 2.3.2.6.7.5 1.8-.2 2.4l-6.8 5.9" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
            <path d="m46.8 5-5.3-.4M48.1 8.4l-.8 4.2" stroke="currentColor" strokeLinecap="round" strokeWidth="2.1" />
          </g>
        </svg>
      </div>
      {!compact && (
        <span className="brand-name">
          healtrip<span>+</span>
        </span>
      )}
    </div>
  );
}

export function Sparkle({ className = "" }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M12 2.8c.6 5.6 3.6 8.6 9.2 9.2-5.6.6-8.6 3.6-9.2 9.2C11.4 15.6 8.4 12.6 2.8 12 8.4 11.4 11.4 8.4 12 2.8Z" fill="currentColor" />
    </Icon>
  );
}

export const PlusIcon = () => (
  <Icon><path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></Icon>
);
export const HeartIcon = () => (
  <Icon><path d="M12 20s-7-4.4-7-10a3.8 3.8 0 0 1 7-2 3.8 3.8 0 0 1 7 2c0 5.6-7 10-7 10Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /></Icon>
);
export const PillIcon = () => (
  <Icon><path d="m7.2 16.8 9.6-9.6a3 3 0 0 0-4.2-4.2L3 12.6a3 3 0 0 0 4.2 4.2ZM8 7.8l8.2 8.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></Icon>
);
export const CloseIcon = () => (
  <Icon><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></Icon>
);
export const MenuIcon = () => (
  <Icon><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></Icon>
);
export const DotsIcon = () => (
  <Icon><circle cx="5" cy="12" fill="currentColor" r="1.5" /><circle cx="12" cy="12" fill="currentColor" r="1.5" /><circle cx="19" cy="12" fill="currentColor" r="1.5" /></Icon>
);
export const ClipIcon = () => (
  <Icon><path d="m8.5 12.8 5.8-5.7a3 3 0 0 1 4.2 4.2l-7.3 7.2a5 5 0 0 1-7.1-7l7.1-7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></Icon>
);
export const SendIcon = () => (
  <Icon><path d="m5 12 14-7-4.5 14-2.7-5.1L5 12Zm6.8 1.9L19 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></Icon>
);
export const StopIcon = () => (
  <Icon><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" /></Icon>
);
export const TrashIcon = () => (
  <Icon><path d="M5 7h14M10 7V5h4v2m-7 0 .8 12h8.4L17 7M10 11v5m4-5v5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></Icon>
);
export const AlertIcon = () => (
  <Icon><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" /><path d="M12 7.5v5.5M12 16.4v.1" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></Icon>
);
