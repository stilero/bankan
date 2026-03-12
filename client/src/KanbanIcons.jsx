import React from 'react';

function BaseIcon({ children }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function BacklogIcon() {
  return (
    <BaseIcon>
      <circle cx="8" cy="8" r="4.75" stroke="currentColor" strokeWidth="1.5" opacity="0.8" />
    </BaseIcon>
  );
}

export function PlanningIcon() {
  return (
    <BaseIcon>
      <path
        d="M4 11.5L11.8 3.7C12.3 3.2 13.1 3.2 13.6 3.7C14.1 4.2 14.1 5 13.6 5.5L5.8 13.3L3 14L3.7 11.2L9.2 5.7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </BaseIcon>
  );
}

export function ImplementationIcon() {
  return (
    <BaseIcon>
      <path
        d="M5.5 4L2.5 8L5.5 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 4L13.5 8L10.5 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.9 3.2L7.1 12.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </BaseIcon>
  );
}

export function ReviewIcon() {
  return (
    <BaseIcon>
      <circle cx="7" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9.7 9.7L13 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </BaseIcon>
  );
}

export function DoneIcon() {
  return (
    <BaseIcon>
      <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5.4 8.1L7.2 9.9L10.8 6.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </BaseIcon>
  );
}
