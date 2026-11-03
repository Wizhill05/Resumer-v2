import { permanentRedirect } from "next/navigation"

export default function ConnectRedirect() {
  permanentRedirect("/agent")
}
