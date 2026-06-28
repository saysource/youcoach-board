import { type ComponentProps } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { cn } from '../../lib/cn'
import { usePortalContainer } from '../../lib/board-root'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor

export function PopoverContent({
  className,
  sideOffset = 8,
  align = 'start',
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  // Portal into our scoped root so tokens + dark mode apply (see board-root).
  const container = usePortalContainer()
  return (
    <PopoverPrimitive.Portal container={container ?? undefined}>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md',
          'animate-in fade-in-0 zoom-in-95',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
