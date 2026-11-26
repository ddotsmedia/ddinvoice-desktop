; DDInvoice installer: role page (Main PC / Workstation), silent /ROLE=server|workstation, server services, data-keeping uninstall.
!include nsDialogs.nsh
!include FileFunc.nsh
!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
  Var DD_Role
  Var DD_RoleRadioServer
  Var DD_RoleRadioWs
!else
  Var DD_DeleteData
  Var DD_DeleteCheck
!endif

!macro customInit
  StrCpy $DD_Role "server"
  ${GetParameters} $R0
  ${GetOptions} $R0 "/ROLE=" $R1
  ${If} $R1 == "workstation"
    StrCpy $DD_Role "workstation"
  ${EndIf}
  ; Updating a server PC: release file locks first (migration runs after the files are copied).
  nsExec::Exec 'sc.exe stop DDInvoiceWorker'
  nsExec::Exec 'sc.exe stop DDInvoiceApi'
!macroend

!ifndef BUILD_UNINSTALLER
Function DDRolePage
  ${IfNot} ${Silent}
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 24u "Install type"
    Pop $0
    ${NSD_CreateRadioButton} 10u 30u 95% 12u "Main PC (server): hosts the database and this app"
    Pop $DD_RoleRadioServer
    ${NSD_CreateRadioButton} 10u 48u 95% 12u "Workstation: connects to the Main PC on this network"
    Pop $DD_RoleRadioWs
    ${If} $DD_Role == "workstation"
      ${NSD_Check} $DD_RoleRadioWs
    ${Else}
      ${NSD_Check} $DD_RoleRadioServer
    ${EndIf}
    nsDialogs::Show
  ${EndIf}
FunctionEnd

Function DDRolePageLeave
  ${NSD_GetState} $DD_RoleRadioWs $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $DD_Role "workstation"
  ${Else}
    StrCpy $DD_Role "server"
  ${EndIf}
FunctionEnd

!endif

!macro customPageAfterChangeDir
  Page custom DDRolePage DDRolePageLeave
!macroend

!macro customInstall
  ReadEnvStr $R2 PROGRAMDATA
  CreateDirectory "$R2\DDInvoice"
  FileOpen $R3 "$R2\DDInvoice\role.json" w
  FileWrite $R3 '{"role":"$DD_Role"}'
  FileClose $R3
  ${If} $DD_Role == "server"
    ${If} ${FileExists} "$R2\DDInvoice\server.json"
      ; Update: pre-migrate backup, migrate, restart services.
      nsExec::ExecToLog 'cmd.exe /c ""$INSTDIR\resources\vendor\node\node.exe" "$INSTDIR\resources\dist\setup.cjs" migrate --restart --app-root "$INSTDIR\resources" > "$R2DDInvoiceinstall-out.log" 2>&1"'
    ${Else}
      nsExec::ExecToLog 'cmd.exe /c ""$INSTDIR\resources\vendor\node\node.exe" "$INSTDIR\resources\dist\setup.cjs" install-server --deferred --app-root "$INSTDIR\resources" > "$R2DDInvoiceinstall-out.log" 2>&1"'
    ${EndIf}
    Pop $R4
    ${If} $R4 != 0
      MessageBox MB_OK|MB_ICONSTOP "Server setup failed (code $R4). See $R2\DDInvoice\logs\setup.log" /SD IDOK
      SetErrorLevel 3
    ${EndIf}
  ${EndIf}
!macroend

; Uninstall: services are removed; company data stays unless the box is ticked AND confirmed twice.
!macro customUnInstallPage
!macroend

!ifdef BUILD_UNINSTALLER
Function un.DDDeletePage
  ${IfNot} ${Silent}
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 24u "Services are removed. Company data in %PROGRAMDATA%\DDInvoice is kept by default."
    Pop $0
    ${NSD_CreateCheckbox} 0 36u 100% 12u "Delete all company data (cannot be undone)"
    Pop $DD_DeleteCheck
    nsDialogs::Show
  ${EndIf}
FunctionEnd

Function un.DDDeletePageLeave
  ${NSD_GetState} $DD_DeleteCheck $0
  StrCpy $DD_DeleteData "0"
  ${If} $0 == ${BST_CHECKED}
    MessageBox MB_YESNO|MB_ICONEXCLAMATION "This permanently deletes every invoice, journal and backup on this PC. Continue?" IDYES +2
    Goto done
    MessageBox MB_YESNO|MB_ICONSTOP "Final confirmation: delete ALL company data now?" IDYES +2
    Goto done
    StrCpy $DD_DeleteData "1"
  ${EndIf}
  done:
FunctionEnd

!endif

!macro customUnWelcomePage
  UninstPage custom un.DDDeletePage un.DDDeletePageLeave
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customUnInstall
  ReadEnvStr $R2 PROGRAMDATA
  ; An update runs the old uninstaller with --updated: services must stay.
  ${IfNot} ${isUpdated}
  ${If} ${FileExists} "$R2\DDInvoice\server.json"
    ${If} $DD_DeleteData == "1"
      nsExec::ExecToLog '"$INSTDIR\resources\vendor\node\node.exe" "$INSTDIR\resources\dist\setup.cjs" uninstall-server --delete-data --data-dir "$R2\DDInvoice" --app-root "$INSTDIR\resources"'
    ${Else}
      nsExec::ExecToLog '"$INSTDIR\resources\vendor\node\node.exe" "$INSTDIR\resources\dist\setup.cjs" uninstall-server --data-dir "$R2\DDInvoice" --app-root "$INSTDIR\resources"'
    ${EndIf}
  ${EndIf}
  ${EndIf}
!macroend
