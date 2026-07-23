import { type ComponentProps } from 'react'
import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

// Trimmed shadcn button: the variants/sizes the Phase 1 shell actually uses.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-5 [&_svg]:[stroke-width:1.5]",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'icon' },
  },
)

export interface ButtonProps
  extends ComponentProps<'button'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  // Default to type="button". A bare <button> is type="submit", and the board
  // has no forms of its own — but a HOST may mount it inside one (App2's drill
  // editor does), where every unqualified control would submit that form.
  // Placed before `...props` so a caller can still override; skipped for
  // asChild, whose child may not be a button element at all.
  const type = asChild ? undefined : ('button' as const)
  return <Comp type={type} className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { buttonVariants }
