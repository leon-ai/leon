import { Loader } from '@/components/loader'
import logo from '../../../public/img/logo-color.svg'
import './desktop-startup.sass'

/**
 * Gives native startup a first painted view without delaying server readiness.
 * Measurable installation work uses the detailed progress view on the same root.
 */
export function DesktopStartupView() {
  return <main className="desktop-startup" aria-label="Starting Leon">
    <img src={logo} width="64" height="68" alt="" aria-hidden="true" />
    <h1>Leon</h1>
    <Loader label="I’m getting ready…" />
  </main>
}
