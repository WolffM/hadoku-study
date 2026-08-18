import { createRoot, type Root } from 'react-dom/client'
import { logger } from '@wolffm/logger/client'
import App from './App'
// REQUIRED: Import @wolffm/themes CSS - DO NOT REMOVE
import '@wolffm/themes/style.css'
// REQUIRED: AppHeader styles (imports theme-picker.css itself — importing only
// the picker leaves the header markup unstyled)
import '@wolffm/task-ui-components/app-header.css'
import './styles/index.css'

// Props interface for configuration from parent app
export interface StudyProps {
  theme?: string // Theme passed from parent (e.g., 'default', 'ocean', 'forest')
  apiBaseUrl?: string // Injected from registry props for apps with a worker API
}

// Extend HTMLElement to include __root property
interface StudyElement extends HTMLElement {
  __root?: Root
}

// Mount function - called by parent to initialize your app
export function mount(el: HTMLElement, props: StudyProps = {}) {
  const root = createRoot(el)
  root.render(<App {...props} />)
  ;(el as StudyElement).__root = root
  logger.info('[study] Mounted successfully', { theme: props.theme })
}

// Unmount function - called by parent to cleanup your app
export function unmount(el: HTMLElement) {
  ;(el as StudyElement).__root?.unmount()
  logger.info('[study] Unmounted successfully')
}
