import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/button'
import { enableDesktopComputerUse } from '@/data/desktop-computer-use'
import { DesktopComputerUseApproval } from '../../../../../bridges/runtime/contracts/desktop-client'

/**
 * Sends an explicit owner click to the native confirmation dialog.
 */
export function ComputerUsePermission() {
  const approval = useMutation({ retry: false, meta: { errorToast: false },
    mutationFn: () => enableDesktopComputerUse(DesktopComputerUseApproval.Confirm) })

  return <div className="leon-message">
    {approval.data === true ? <p role="status">I can use this computer now. Send your request again.</p> : <>
      <p>I need permission to use this computer.</p>
      <Button variant="secondary" loading={approval.isPending} disabled={approval.isPending}
        onClick={() => approval.mutate()}>Enable computer use</Button>
      {approval.error && <p role="alert">{approval.error.message}</p>}
    </>}
  </div>
}
