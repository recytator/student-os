import * as Dialog from '@radix-ui/react-dialog';
import { X, type LucideIcon } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
  size?: 'sm' | 'md' | 'icon';
};
export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cn('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, className)}
      {...props}
    />
  );
}

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('field', className)}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'green' | 'amber' | 'red' | 'blue';
  className?: string;
}) {
  return <span className={cn('badge', `badge-${tone}`, className)}>{children}</span>;
}

export function Empty({
  icon: Icon,
  title,
  children,
  action,
  compact,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn('empty', compact && 'empty-compact')}>
      <Icon size={compact ? 18 : 22} strokeWidth={1.6} />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  className,
  flush,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={cn('card', flush && 'card-flush', className)}>
      {(title || action) && (
        <header className="card-header">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          role="tab"
          aria-selected={value === option.value}
          key={option.value}
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className={cn('modal', `modal-${size}`)}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            const target = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
              '[data-autofocus]',
            );
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
        >
          <header className="modal-header">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {description && <p className="modal-description">{description}</p>}
            </div>
            <Dialog.Close className="icon-btn" aria-label="Zamknij">
              <X size={18} />
            </Dialog.Close>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-footer">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type Toast = {
  id: number;
  message: string;
  tone: 'default' | 'error';
  action?: { label: string; run: () => void };
};
type ConfirmOptions = { title: string; message?: string; confirm?: string; danger?: boolean };
type FeedbackContext = {
  toast: (message: string, options?: { tone?: Toast['tone']; action?: Toast['action'] }) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};
const Feedback = createContext<FeedbackContext | null>(null);
export const useFeedback = () => {
  const value = useContext(Feedback);
  if (!value) throw new Error('FeedbackProvider missing');
  return value;
};

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<
    (ConfirmOptions & { resolve: (v: boolean) => void }) | null
  >(null);
  const counter = useRef(0);
  const dismiss = useCallback(
    (id: number) => setToasts((all) => all.filter((t) => t.id !== id)),
    [],
  );
  const toast = useCallback<FeedbackContext['toast']>(
    (message, options) => {
      const id = ++counter.current;
      setToasts((all) => [
        ...all.slice(-2),
        { id, message, tone: options?.tone ?? 'default', action: options?.action },
      ]);
      window.setTimeout(
        () => dismiss(id),
        options?.action ? 6500 : options?.tone === 'error' ? 8000 : 3800,
      );
    },
    [dismiss],
  );
  const confirm = useCallback<FeedbackContext['confirm']>(
    (options) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );
  const close = (result: boolean) => {
    pending?.resolve(result);
    setPending(null);
  };
  return (
    <Feedback.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((item) => (
          <div
            key={item.id}
            className={cn('toast', item.tone === 'error' && 'toast-error')}
            role="status"
          >
            <span>{item.message}</span>
            {item.action && (
              <button
                type="button"
                onClick={() => {
                  item.action!.run();
                  dismiss(item.id);
                }}
              >
                {item.action.label}
              </button>
            )}
            <button
              type="button"
              className="toast-close"
              aria-label="Zamknij powiadomienie"
              onClick={() => dismiss(item.id)}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      {pending && (
        <Modal
          title={pending.title}
          size="sm"
          onClose={() => close(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => close(false)}>
                Anuluj
              </Button>
              <Button
                variant={pending.danger ? 'danger' : 'primary'}
                onClick={() => close(true)}
                data-autofocus
              >
                {pending.confirm ?? 'Potwierdź'}
              </Button>
            </>
          }
        >
          {pending.message && <p className="confirm-text">{pending.message}</p>}
        </Modal>
      )}
    </Feedback.Provider>
  );
}

export function SubjectDot({ color, size = 8 }: { color?: string; size?: number }) {
  return (
    <span
      className="subject-dot"
      style={{ background: color ?? 'var(--text-3)', width: size, height: size }}
      aria-hidden
    />
  );
}
