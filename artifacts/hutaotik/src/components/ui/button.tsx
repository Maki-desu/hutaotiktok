import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
" hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border border-primary-border shadow-[0_6px_16px_-4px_hsl(var(--primary)/0.45),0_2px_6px_rgba(0,0,0,0.35)] hover:shadow-[0_10px_22px_-4px_hsl(var(--primary)/0.55),0_4px_10px_rgba(0,0,0,0.40)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_6px_14px_-4px_hsl(var(--destructive)/0.45),0_2px_6px_rgba(0,0,0,0.35)] border-destructive-border",
        outline:
          "border [border-color:var(--button-outline)] shadow-[0_2px_8px_rgba(0,0,0,0.26)] hover:shadow-[0_5px_14px_rgba(0,0,0,0.36)] active:shadow-none",
        secondary:
          "border bg-secondary text-secondary-foreground border border-secondary-border shadow-[0_2px_8px_rgba(0,0,0,0.28)]",
        ghost: "border border-transparent",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
