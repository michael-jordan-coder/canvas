import { type ReactElement } from 'react'
import * as RadixAvatar from '@radix-ui/react-avatar'

export interface AvatarProps {
  src?: string
  fallback?: string
  alt?: string
}

/**
 * An avatar, on Radix's primitive, which is here for the one thing that is genuinely awkward:
 * it only swaps in the fallback once the image has actually failed, so there is no flash of
 * initials while a picture that is going to load is loading.
 */
export function Avatar({ src = '', fallback = 'DG', alt = '' }: AvatarProps): ReactElement {
  return (
    <RadixAvatar.Root className="avatar">
      {src && <RadixAvatar.Image className="avatar-image" src={src} alt={alt} />}
      <RadixAvatar.Fallback className="avatar-fallback">{fallback}</RadixAvatar.Fallback>
    </RadixAvatar.Root>
  )
}
