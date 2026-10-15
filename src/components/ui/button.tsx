import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Local shadcn-style primitive: variants stay editable in the product repository.
const buttonVariants = cva('button', {
  variants: {
    kind: { primary: 'primary', secondary: 'secondary', ghost: 'ghost', danger: 'danger' },
  },
  defaultVariants: { kind: 'primary' },
});

type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>;
export function Button({ kind, className, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={twMerge(clsx(buttonVariants({ kind }), className))} {...props} />
  );
}
