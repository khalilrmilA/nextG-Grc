/**
 * AiGate — wraps AI feature pages/components.
 * NOTE: AI access limitation is temporarily DISABLED.
 * Component just passes children through without any access checks.
 */

interface AiGateProps {
  readonly children: React.ReactNode;
}

export default function AiGate({ children }: AiGateProps) {
  return <>{children}</>;
}
