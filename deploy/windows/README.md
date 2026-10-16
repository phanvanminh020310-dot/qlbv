# QLBS Kiosk 2.0.4 — WinForms workstation

`QLBS_Kiosk.exe` is the native Windows kiosk for an outpatient workstation. It does not use Edge Kiosk, WebView, a local unlock service, or the legacy `QLBS_Kiosk_Agent.exe`.

## Operating policy (2.0.4)

- The kiosk applies to **every interactive Windows account**, including local/domain **Administrators** and UAC-filtered Administrator tokens. Nobody has to change to a standard account for it to run.
- It overlays and hooks the desktop **only** when an **online** QLBV reconciliation confirms an assigned, published/locked shift that is **currently inside its exact time interval** for the configured room.
- No current shift, an upcoming shift, a completed shift, an early-arrival window, a post-shift grace window, an unpublished/draft period, or an unavailable roster reconciliation **does not lock** the desktop.
- If the workstation loses connection to QLBV/API, resumes from sleep, or receives an invalid status response, it immediately releases the desktop. Once online again, it locks again only if the next status confirms a current shift.
- QR is created only while a current shift needs kiosk protection. At the end of a shift (for example 17:00), the desktop remains open unless the next online reconciliation confirms another shift already in progress.
- The IT button and `Ctrl+Alt+Shift+F12` remain available only while locked. Its PIN is verified online and is bound to the current active shift; there is no offline/local PIN or default PIN in the EXE.

Installation, update, and uninstall still require UAC Administrator rights. This is separate from the runtime policy above.

## Before installing a PC

1. Deploy the server revision first. From the QLBV repository on VPS 1:

   ```bash
   sudo bash deploy/update.sh
   ```

   The updater preserves database/configuration and restarts only the affected services. Do not manually replace Docker volumes or `.env` files.

2. In QLBV, ensure the room code is active and the relevant period is published or locked. The doctor must be assigned and active; approved absence removes the shift from kiosk eligibility.
3. Configure a unique online **PIN IT** in System settings. Do not rely on any old/default PIN.
4. Make sure the PC and phone can reach the same public QLBV web origin (HTTPS is required for the normal phone camera workflow).

## Install or update a workstation

After the 2.0.4 release is published, download `QLBS_Kiosk_2.0.4.zip` and its SHA-256 checksum from the repository Release assets. Do not use GitHub's `Source code (zip)` as an EXE package.

1. Extract to a local folder; do not launch directly inside the ZIP.
2. Verify the `QLBS_Kiosk.exe` hash against `SHA256SUMS.txt`.
3. Run `QLBS_Kiosk.exe`, enter the **web origin** (for example `https://qlbv.benhvien.vn:3000`) and the exact room code (for example `PK01`). Do not enter `/api`, port 4000, the AI port, or `localhost`.
4. Choose **Kiểm tra kết nối**, then **Cài đặt máy trạm** and accept UAC.

Silent deployment from an elevated command prompt:

```bat
QLBS_Kiosk.exe /install /server https://qlbv.benhvien.vn:3000 /room PK01 /quiet /no-start
```

Each PC creates and retains its own terminal ID in `%ProgramData%\QLBS\Kiosk\config.ini`. Never clone that file between PCs.

## Expected behavior for acceptance

| Situation | Expected desktop state |
|---|---|
| Published/locked, assigned shift currently active and API reachable | Kiosk locks; QR/online IT PIN can release for that current shift. |
| Before start, after end, or no assigned active shift | Desktop open; no QR issued. |
| Shift ends at 17:00 and no shift is currently active after that | Desktop open immediately. |
| Network/API/roster reconciliation fails, boot without network, sleep/resume | Desktop opens immediately; no offline PIN path. |
| Network returns while an active shift is confirmed | Kiosk locks again after status reconciliation. |
| Administrator account signs in | Same online active-shift policy as every other account. |

## Removal

Run `go_bo_kiosk.bat` as Administrator, or:

```bat
"%ProgramFiles%\QLBS Kiosk\QLBS_Kiosk.exe" /uninstall
```

Removal keeps the room/terminal configuration by default. Add `/purge` only when the terminal identity must be retired.

## Validation and release

- Native source policy checks: `python deploy/windows/tests/test_pin_scope.py`
- The Windows CI workflow compiles C# 5/.NET Framework, runs native self-tests, QR fixtures, and keyboard input checks.
- Server/frontend checks and the physical acceptance checklist are described in [KIEM_THU_V2.md](KIEM_THU_V2.md) and [HUONG_DAN_SU_DUNG.md](HUONG_DAN_SU_DUNG.md).

For a release, use **Actions → Kiosk standalone quality gate**, enable `publish_release`, and enter the new tag `kiosk-v2.0.4`. Never overwrite previous release assets.
