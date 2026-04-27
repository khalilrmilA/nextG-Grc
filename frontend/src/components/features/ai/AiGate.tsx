/**
 * AiGate — wraps AI feature pages/components.
 * NOTE: AI access limitation is temporarily DISABLED.
 * Component just passes children through without any access checks.
 */

interface AiGateProps {
  readonly children: React.ReactNode;
  readonly featureLabel?: string;
}

export default function AiGate({ children, featureLabel: _featureLabel }: AiGateProps) {
  return <>{children}</>;
}
