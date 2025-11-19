#define RootLicenseFileName FileExists(RepoDir + '\LICENSE.rtf') ? 'LICENSE.rtf' : 'LICENSE.txt'
#define LocalizedLanguageFile(Language = "") \
    DirExists(RepoDir + "\licenses") && Language != "" \
      ? ('; LicenseFile: "' + RepoDir + '\licenses\LICENSE-' + Language + '.rtf"') \
      : '; LicenseFile: "' + RepoDir + '\' + RootLicenseFileName + '"'

[Setup]
AppId={#AppId}
AppName={#NameLong}
AppVerName={#NameVersion}
AppPublisher=Posit Software, PBC
AppPublisherURL=https://posit.co/
AppSupportURL=https://posit.co/support/
AppUpdatesURL=https://posit.co/
DefaultGroupName={#NameLong}
AllowNoIcons=yes
OutputDir={#OutputDir}
OutputBaseFilename=PositronSetup
Compression=lzma
SolidCompression=yes
AppMutex={code:GetAppMutex}
SetupMutex={#AppMutex}setup
WizardImageFile="{#RepoDir}\resources\win32\positron-inno-big-100.bmp,{#RepoDir}\resources\win32\positron-inno-big-125.bmp,{#RepoDir}\resources\win32\positron-inno-big-150.bmp,{#RepoDir}\resources\win32\positron-inno-big-175.bmp,{#RepoDir}\resources\win32\positron-inno-big-200.bmp,{#RepoDir}\resources\win32\positron-inno-big-225.bmp,{#RepoDir}\resources\win32\positron-inno-big-250.bmp"
WizardSmallImageFile="{#RepoDir}\resources\win32\positron-inno-small-100.bmp,{#RepoDir}\resources\win32\positron-inno-small-125.bmp,{#RepoDir}\resources\win32\positron-inno-small-150.bmp,{#RepoDir}\resources\win32\positron-inno-small-175.bmp,{#RepoDir}\resources\win32\positron-inno-small-200.bmp,{#RepoDir}\resources\win32\positron-inno-small-225.bmp,{#RepoDir}\resources\win32\positron-inno-small-250.bmp"
SetupIconFile={#RepoDir}\resources\win32\positron.ico
UninstallDisplayIcon={app}\{#ExeBasename}.exe
ChangesEnvironment=true
ChangesAssociations=true
MinVersion=10.0
SourceDir={#SourceDir}
AppVersion={#Version}
VersionInfoVersion={#RawVersion}
ShowLanguageDialog=auto
ArchitecturesAllowed={#ArchitecturesAllowed}
ArchitecturesInstallIn64BitMode={#ArchitecturesInstallIn64BitMode}
WizardStyle=modern

// We've seen an uptick on broken installations from updates which were unable
// to shutdown VS Code. We rely on the fact that the update signals
// that VS Code is ready to be shutdown, so we're good to use `force` here.
CloseApplications=force

#ifdef Sign
SignTool=esrp
#endif

#if "user" == InstallTarget
DefaultDirName={userpf}\{#DirName}
PrivilegesRequired=lowest
#else
DefaultDirName={pf}\{#DirName}
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl,{#RepoDir}\build\win32\i18n\messages.en.isl" {#LocalizedLanguageFile}
Name: "german"; MessagesFile: "compiler:Languages\German.isl,{#RepoDir}\build\win32\i18n\messages.de.isl" {#LocalizedLanguageFile("deu")}
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl,{#RepoDir}\build\win32\i18n\messages.es.isl" {#LocalizedLanguageFile("esp")}
Name: "french"; MessagesFile: "compiler:Languages\French.isl,{#RepoDir}\build\win32\i18n\messages.fr.isl" {#LocalizedLanguageFile("fra")}
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl,{#RepoDir}\build\win32\i18n\messages.it.isl" {#LocalizedLanguageFile("ita")}
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl,{#RepoDir}\build\win32\i18n\messages.ja.isl" {#LocalizedLanguageFile("jpn")}
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl,{#RepoDir}\build\win32\i18n\messages.ru.isl" {#LocalizedLanguageFile("rus")}
Name: "korean"; MessagesFile: "{#RepoDir}\build\win32\i18n\Default.ko.isl,{#RepoDir}\build\win32\i18n\messages.ko.isl" {#LocalizedLanguageFile("kor")}
Name: "simplifiedChinese"; MessagesFile: "{#RepoDir}\build\win32\i18n\Default.zh-cn.isl,{#RepoDir}\build\win32\i18n\messages.zh-cn.isl" {#LocalizedLanguageFile("chs")}
Name: "traditionalChinese"; MessagesFile: "{#RepoDir}\build\win32\i18n\Default.zh-tw.isl,{#RepoDir}\build\win32\i18n\messages.zh-tw.isl" {#LocalizedLanguageFile("cht")}
Name: "brazilianPortuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl,{#RepoDir}\build\win32\i18n\messages.pt-br.isl" {#LocalizedLanguageFile("ptb")}
Name: "hungarian"; MessagesFile: "{#RepoDir}\build\win32\i18n\Default.hu.isl,{#RepoDir}\build\win32\i18n\messages.hu.isl" {#LocalizedLanguageFile("hun")}
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl,{#RepoDir}\build\win32\i18n\messages.tr.isl" {#LocalizedLanguageFile("trk")}

[InstallDelete]
Type: filesandordirs; Name: "{app}\resources\app\out"; Check: IsNotBackgroundUpdate
Type: filesandordirs; Name: "{app}\resources\app\plugins"; Check: IsNotBackgroundUpdate
Type: filesandordirs; Name: "{app}\resources\app\extensions"; Check: IsNotBackgroundUpdate
Type: filesandordirs; Name: "{app}\resources\app\node_modules"; Check: IsNotBackgroundUpdate
Type: filesandordirs; Name: "{app}\resources\app\node_modules.asar.unpacked"; Check: IsNotBackgroundUpdate
Type: files; Name: "{app}\resources\app\node_modules.asar"; Check: IsNotBackgroundUpdate
Type: files; Name: "{app}\resources\app\Credits_45.0.2454.85.html"; Check: IsNotBackgroundUpdate

[UninstallDelete]
Type: filesandordirs; Name: "{app}\_"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "quicklaunchicon"; Description: "{cm:CreateQuickLaunchIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked; OnlyBelowVersion: 0,6.1
Name: "addcontextmenufiles"; Description: "{cm:AddContextMenuFiles,{#NameShort}}"; GroupDescription: "{cm:Other}"; Flags: unchecked
Name: "addcontextmenufolders"; Description: "{cm:AddContextMenuFolders,{#NameShort}}"; GroupDescription: "{cm:Other}"; Flags: unchecked; Check: not (IsWindows11OrLater and QualityIsInsiders)
Name: "associatewithfiles"; Description: "{cm:AssociateWithFiles,{#NameShort}}"; GroupDescription: "{cm:Other}"
Name: "addtopath"; Description: "{cm:AddToPath}"; GroupDescription: "{cm:Other}"
Name: "runcode"; Description: "{cm:RunAfter,{#NameShort}}"; GroupDescription: "{cm:Other}"; Check: WizardSilent

[Dirs]
Name: "{app}"; AfterInstall: DisableAppDirInheritance

[Files]
Source: "*"; Excludes: "\CodeSignSummary*.md,\tools,\tools\*,\appx,\appx\*,\resources\app\product.json"; DestDir: "{code:GetDestDir}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "tools\*"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "{#ProductJsonPath}"; DestDir: "{code:GetDestDir}\resources\app"; Flags: ignoreversion
#ifdef AppxPackageFullname
Source: "appx\*"; DestDir: "{app}\appx"; BeforeInstall: RemoveAppxPackage; AfterInstall: AddAppxPackage; Flags: ignoreversion; Check: IsWindows11OrLater and QualityIsInsiders
#endif

[Icons]
Name: "{group}\{#NameLong}"; Filename: "{app}\{#ExeBasename}.exe"; AppUserModelID: "{#AppUserId}"
Name: "{autodesktop}\{#NameLong}"; Filename: "{app}\{#ExeBasename}.exe"; Tasks: desktopicon; AppUserModelID: "{#AppUserId}"
Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\{#NameLong}"; Filename: "{app}\{#ExeBasename}.exe"; Tasks: quicklaunchicon; AppUserModelID: "{#AppUserId}"

[Run]
Filename: "{app}\{#ExeBasename}.exe"; Description: "{cm:LaunchProgram,{#NameLong}}"; Tasks: runcode; Flags: nowait postinstall; Check: ShouldRunAfterUpdate
Filename: "{app}\{#ExeBasename}.exe"; Description: "{cm:LaunchProgram,{#NameLong}}"; Flags: nowait postinstall; Check: WizardNotSilent

#ifdef AppxPackageFullname
[UninstallRun]
Filename: "powershell.exe"; Parameters: "Invoke-Command -ScriptBlock {{Remove-AppxPackage -Package ""{#AppxPackageFullname}""}"; Check: IsWindows11OrLater and QualityIsInsiders; Flags: shellexec waituntilterminated runhidden
#endif

[Registry]
#if "user" == InstallTarget
#define SoftwareClassesRootKey "HKCU"
#else
#define SoftwareClassesRootKey "HKLM"
#endif

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.bash\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.bash\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.bash"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Bash}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\shell.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.bash_login\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.bash_login\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.bash_login"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash_login"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Bash Login}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash_login"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash_login\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\shell.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash_login\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash_login\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.bash_logout\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.bash_logout\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.bash_logout"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash_logout"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Bash Logout}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash_logout"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash_logout\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\shell.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash_logout\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash_logout\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.bash_profile\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.bash_profile\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.bash_profile"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash_profile"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Bash Profile}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash_profile"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash_profile\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\shell.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash_profile\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bash_profile\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.bashrc\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.bashrc\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.bashrc"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bashrc"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Bash RC}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bashrc"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bashrc\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\shell.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bashrc\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bashrc\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.bib\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.bib\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.bib"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bib"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,BibTeX}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bib"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bib\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\default.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bib\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.bib\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.diff\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.diff\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.diff"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.diff"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Diff}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.diff"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.diff\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\default.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.diff\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.diff\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.dockerfile\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.dockerfile\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.dockerfile"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.dockerfile"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Dockerfile}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.dockerfile"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.dockerfile\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\default.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.dockerfile\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.dockerfile\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.dot\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.dot\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.dot"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.dot"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Dot}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.dot"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.dot\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\default.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.dot\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.dot\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.editorconfig\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.editorconfig\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.editorconfig"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.editorconfig"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Editor Config}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.editorconfig"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.editorconfig\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\config.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.editorconfig\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.editorconfig\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.gitattributes\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.gitattributes\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.gitattributes"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitattributes"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Git Attributes}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitattributes"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitattributes"; ValueType: string; ValueName: "AlwaysShowExt"; ValueData: ""; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitattributes\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\config.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitattributes\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitattributes\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.gitconfig\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.gitconfig\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.gitconfig"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitconfig"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Git Config}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitconfig"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitconfig"; ValueType: string; ValueName: "AlwaysShowExt"; ValueData: ""; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitconfig\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\config.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitconfig\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitconfig\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.gitignore\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.gitignore\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.gitignore"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitignore"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Git Ignore}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitignore"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitignore"; ValueType: string; ValueName: "AlwaysShowExt"; ValueData: ""; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitignore\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\config.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitignore\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.gitignore\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.ipynb\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.ipynb\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.ipynb"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.ipynb"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Jupyter}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.ipynb"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.ipynb\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\default.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.ipynb\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.ipynb\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.lua\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.lua\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.lua"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.lua"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Lua}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.lua"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.lua\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\default.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.lua\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.lua\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.m\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.m\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.m"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.m"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Objective C}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.m"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.m\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\default.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.m\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.m\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.makefile\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.makefile\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.makefile"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.makefile"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Makefile}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.makefile"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.makefile\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\default.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.makefile\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.makefile\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.markdown"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.markdown"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Markdown}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.markdown"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.markdown\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\markdown.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.markdown\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.markdown\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.md"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.md"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Markdown}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.md"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.md\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\markdown.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.md\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.md\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mdoc\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mdoc\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.mdoc"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdoc"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,MDoc}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdoc"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdoc\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\markdown.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdoc\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdoc\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mdown\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mdown\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.mdown"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdown"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Markdown}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdown"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdown\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\markdown.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdown\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdown\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mdtext\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mdtext\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.mdtext"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdtext"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Markdown}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdtext"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdtext\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\markdown.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdtext\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdtext\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mdtxt\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mdtxt\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.mdtxt"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdtxt"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Markdown}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdtxt"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdtxt\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\markdown.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdtxt\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdtxt\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mdwn\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mdwn\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.mdwn"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdwn"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Markdown}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdwn"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdwn\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\markdown.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdwn\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mdwn\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mk\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mk\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.mk"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mk"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Makefile}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mk"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mk\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\default.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mk\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mk\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mkd\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mkd\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.mkd"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mkd"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Markdown}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mkd"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mkd\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\markdown.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mkd\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mkd\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mkdn\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mkdn\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.mkdn"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mkdn"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Markdown}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mkdn"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mkdn\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\markdown.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mkdn\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mkdn\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.ml\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.ml\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.ml"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.ml"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,OCaml}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.ml"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.ml\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\default.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.ml\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.ml\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mjs\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.mjs\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.mjs"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mjs"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,JavaScript}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mjs"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mjs\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\javascript.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mjs\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.mjs\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.profile\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.profile\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.profile"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.profile"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Profile}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.profile"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.profile\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\shell.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.profile\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.profile\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.py\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.py\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.py"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.py"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Python}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.py"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.py\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\python.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.py\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.py\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.pyi\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.pyi\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.pyi"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.pyi"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Python}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.pyi"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.pyi\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\python.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.pyi\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.pyi\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.r\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.r\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.r"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.r"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,R}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.r"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.r\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\default.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.r\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.r\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.rhistory\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.rhistory\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.rhistory"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.rhistory"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,R History}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.rhistory"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.rhistory\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\shell.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.rhistory\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.rhistory\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.rprofile\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.rprofile\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.rprofile"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.rprofile"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,R Profile}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.rprofile"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.rprofile\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\shell.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.rprofile\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.rprofile\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.sass\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.sass\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.sass"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.sass"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Sass}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.sass"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.sass\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\sass.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.sass\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.sass\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.scss\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.scss\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.scss"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.scss"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Sass}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.scss"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.scss\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\sass.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.scss\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.scss\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.sh\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.sh\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.sh"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.sh"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,SH}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.sh"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.sh\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\shell.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.sh\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.sh\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.sql\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.sql\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.sql"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.sql"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,SQL}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.sql"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.sql\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\sql.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.sql\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.sql\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.tex\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.tex\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.tex"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.tex"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,LaTeX}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.tex"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.tex\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\default.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.tex\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.tex\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.toml\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.toml\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.toml"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.toml"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Toml}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.toml"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.toml\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\default.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.toml\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.toml\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.txt\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.txt\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.txt"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.txt"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Text}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.txt"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.txt\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\default.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.txt\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.txt\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.yaml\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.yaml\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.yaml"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.yaml"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Yaml}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.yaml"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.yaml\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\yaml.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.yaml\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.yaml\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.yml\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.yml\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.yml"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.yml"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Yaml}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.yml"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.yml\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\yaml.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.yml\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.yml\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.zsh\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.zsh\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.zsh"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.zsh"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,ZSH}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.zsh"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.zsh\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\shell.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.zsh\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.zsh\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}SourceFile"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,{#NameLong}}"; Flags: uninsdeletekey
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}SourceFile\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\default.ico"
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}SourceFile\shell\open"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"""
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}SourceFile\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\Applications\{#ExeBasename}.exe"; ValueType: none; ValueName: ""; Flags: uninsdeletekey
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\Applications\{#ExeBasename}.exe\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\app\resources\win32\default.ico"
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\Applications\{#ExeBasename}.exe\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\Applications\{#ExeBasename}.exe\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}ContextMenu"; ValueType: expandsz; ValueName: "Title"; ValueData: "{cm:OpenWithCodeContextMenu,{#ShellNameShort}}"; Tasks: addcontextmenufiles; Flags: uninsdeletekey; Check: IsWindows11OrLater and QualityIsInsiders
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\*\shell\{#RegValueName}"; ValueType: expandsz; ValueName: ""; ValueData: "{cm:OpenWithCodeContextMenu,{#ShellNameShort}}"; Tasks: addcontextmenufiles; Flags: uninsdeletekey; Check: not (IsWindows11OrLater and QualityIsInsiders)
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\*\shell\{#RegValueName}"; ValueType: expandsz; ValueName: "Icon"; ValueData: "{app}\{#ExeBasename}.exe"; Tasks: addcontextmenufiles; Check: not (IsWindows11OrLater and QualityIsInsiders)
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\*\shell\{#RegValueName}\command"; ValueType: expandsz; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: addcontextmenufiles; Check: not (IsWindows11OrLater and QualityIsInsiders)
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\directory\shell\{#RegValueName}"; ValueType: expandsz; ValueName: ""; ValueData: "{cm:OpenWithCodeContextMenu,{#ShellNameShort}}"; Tasks: addcontextmenufolders; Flags: uninsdeletekey; Check: not (IsWindows11OrLater and QualityIsInsiders)
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\directory\shell\{#RegValueName}"; ValueType: expandsz; ValueName: "Icon"; ValueData: "{app}\{#ExeBasename}.exe"; Tasks: addcontextmenufolders; Check: not (IsWindows11OrLater and QualityIsInsiders)
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\directory\shell\{#RegValueName}\command"; ValueType: expandsz; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%V"""; Tasks: addcontextmenufolders; Check: not (IsWindows11OrLater and QualityIsInsiders)
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\directory\background\shell\{#RegValueName}"; ValueType: expandsz; ValueName: ""; ValueData: "{cm:OpenWithCodeContextMenu,{#ShellNameShort}}"; Tasks: addcontextmenufolders; Flags: uninsdeletekey; Check: not (IsWindows11OrLater and QualityIsInsiders)
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\directory\background\shell\{#RegValueName}"; ValueType: expandsz; ValueName: "Icon"; ValueData: "{app}\{#ExeBasename}.exe"; Tasks: addcontextmenufolders; Check: not (IsWindows11OrLater and QualityIsInsiders)
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\directory\background\shell\{#RegValueName}\command"; ValueType: expandsz; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%V"""; Tasks: addcontextmenufolders; Check: not (IsWindows11OrLater and QualityIsInsiders)
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\Drive\shell\{#RegValueName}"; ValueType: expandsz; ValueName: ""; ValueData: "{cm:OpenWithCodeContextMenu,{#ShellNameShort}}"; Tasks: addcontextmenufolders; Flags: uninsdeletekey; Check: not (IsWindows11OrLater and QualityIsInsiders)
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\Drive\shell\{#RegValueName}"; ValueType: expandsz; ValueName: "Icon"; ValueData: "{app}\{#ExeBasename}.exe"; Tasks: addcontextmenufolders; Check: not (IsWindows11OrLater and QualityIsInsiders)
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\Drive\shell\{#RegValueName}\command"; ValueType: expandsz; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%V"""; Tasks: addcontextmenufolders; Check: not (IsWindows11OrLater and QualityIsInsiders)

// Clean up stale MuiCache registry entries that may have older names of Positron, this is only ever under HKCU
Root: HKCU; Subkey: "Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache"; ValueName: "{app}\{#ExeBasename}.exe.FriendlyAppName"; Flags: deletevalue noerror

; Environment
#if "user" == InstallTarget
#define EnvironmentRootKey "HKCU"
#define EnvironmentKey "Environment"
#define Uninstall64RootKey "HKCU64"
#define Uninstall32RootKey "HKCU32"
#else
#define EnvironmentRootKey "HKLM"
#define EnvironmentKey "System\CurrentControlSet\Control\Session Manager\Environment"
#define Uninstall64RootKey "HKLM64"
#define Uninstall32RootKey "HKLM32"
#endif

Root: {#EnvironmentRootKey}; Subkey: "{#EnvironmentKey}"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}\bin"; Tasks: addtopath; Check: NeedsAddPath(ExpandConstant('{app}\bin'))

[Code]
function IsBackgroundUpdate(): Boolean;
begin
  Result := ExpandConstant('{param:update|false}') <> 'false';
end;

function IsNotBackgroundUpdate(): Boolean;
begin
  Result := not IsBackgroundUpdate();
end;

// Don't allow installing conflicting architectures
function InitializeSetup(): Boolean;
var
  RegKey: String;
  ThisArch: String;
  AltArch: String;
begin
  Result := True;

  #if "user" == InstallTarget
    if not WizardSilent() and IsAdmin() then begin
      if MsgBox('This User Installer is not meant to be run as an Administrator. If you would like to install Positron for all users in this system, download the System Installer instead from https://positron.posit.co. Are you sure you want to continue?', mbError, MB_OKCANCEL) = IDCANCEL then begin
        Result := False;
      end;
    end;
  #endif

  #if "user" == InstallTarget
    #if "arm64" == Arch
      #define IncompatibleArchRootKey "HKLM32"
    #else
      #define IncompatibleArchRootKey "HKLM64"
    #endif

    if Result and not WizardSilent() then begin
      RegKey := 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\' + copy('{#IncompatibleTargetAppId}', 2, 38) + '_is1';

      if RegKeyExists({#IncompatibleArchRootKey}, RegKey) then begin
        if MsgBox('{#NameShort} is already installed on this system for all users. We recommend first uninstalling that version before installing this one. Are you sure you want to continue the installation?', mbConfirmation, MB_YESNO) = IDNO then begin
          Result := False;
        end;
      end;
    end;
  #endif

end;

function WizardNotSilent(): Boolean;
begin
  Result := not WizardSilent();
end;

// Updates

var
	ShouldRestartTunnelService: Boolean;

function StopTunnelOtherProcesses(): Boolean;
var
	WaitCounter: Integer;
	TaskKilled: Integer;
begin
	Log('Stopping all tunnel services (at ' + ExpandConstant('"{app}\bin\{#TunnelApplicationName}.exe"') + ')');
	ShellExec('', 'powershell.exe', '-Command "Get-WmiObject Win32_Process | Where-Object { $_.ExecutablePath -eq ' + ExpandConstant('''{app}\bin\{#TunnelApplicationName}.exe''') + ' } | Select @{Name=''Id''; Expression={$_.ProcessId}} | Stop-Process -Force"', '', SW_HIDE, ewWaitUntilTerminated, TaskKilled)

	WaitCounter := 10;
	while (WaitCounter > 0) and CheckForMutexes('{#TunnelMutex}') do
	begin
		Log('Tunnel process is is still running, waiting');
		Sleep(500);
		WaitCounter := WaitCounter - 1
	end;

	if CheckForMutexes('{#TunnelMutex}') then
		begin
			Log('Unable to stop tunnel processes');
			Result := False;
		end
	else
		Result := True;
end;

procedure StopTunnelServiceIfNeeded();
var
	StopServiceResultCode: Integer;
	WaitCounter: Integer;
begin
  ShouldRestartTunnelService := False;
 	if CheckForMutexes('{#TunnelServiceMutex}') then begin
		// stop the tunnel service
		Log('Stopping the tunnel service using ' + ExpandConstant('"{app}\bin\{#ApplicationName}.cmd"'));
		ShellExec('', ExpandConstant('"{app}\bin\{#ApplicationName}.cmd"'), 'tunnel service uninstall', '', SW_HIDE, ewWaitUntilTerminated, StopServiceResultCode);

		Log('Stopping the tunnel service completed with result code ' + IntToStr(StopServiceResultCode));

		WaitCounter := 10;
		while (WaitCounter > 0) and CheckForMutexes('{#TunnelServiceMutex}') do
		begin
			Log('Tunnel service is still running, waiting');
			Sleep(500);
			WaitCounter := WaitCounter - 1
		end;
		if CheckForMutexes('{#TunnelServiceMutex}') then
			Log('Unable to stop tunnel service')
		else
			ShouldRestartTunnelService := True;
	end
end;


// called before the wizard checks for running application
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  if IsNotBackgroundUpdate() then
    StopTunnelServiceIfNeeded();

  if IsNotBackgroundUpdate() and not StopTunnelOtherProcesses() then
     Result := '{#NameShort} is still running a tunnel process. Please stop the tunnel before installing.'
  else
  	Result := '';
end;

// VS Code will create a flag file before the update starts (/update=C:\foo\bar)
// - if the file exists at this point, the user quit Code before the update finished, so don't start Code after update
// - otherwise, the user has accepted to apply the update and Code should start
function LockFileExists(): Boolean;
begin
  Result := FileExists(ExpandConstant('{param:update}'))
end;

function ShouldRunAfterUpdate(): Boolean;
begin
  if IsBackgroundUpdate() then
    Result := not LockFileExists()
  else
    Result := True;
end;

function IsWindows11OrLater(): Boolean;
begin
  Result := (GetWindowsVersion >= $0A0055F0);
end;

function GetAppMutex(Value: string): string;
begin
  if IsBackgroundUpdate() then
    Result := ''
  else
    Result := '{#AppMutex}';
end;

function GetDestDir(Value: string): string;
begin
  if IsBackgroundUpdate() then
    Result := ExpandConstant('{app}\_')
  else
    Result := ExpandConstant('{app}');
end;

function BoolToStr(Value: Boolean): String;
begin
  if Value then
    Result := 'true'
  else
    Result := 'false';
end;

function QualityIsInsiders(): boolean;
begin
  if '{#Quality}' = 'insider' then
    Result := True
  else
    Result := False;
end;

#ifdef AppxPackageFullname
procedure AddAppxPackage();
var
  AddAppxPackageResultCode: Integer;
begin
  if WizardIsTaskSelected('addcontextmenufiles') then begin
    ShellExec('', 'powershell.exe', '-Command ' + AddQuotes('Add-AppxPackage -Path ''' + ExpandConstant('{app}\appx\{#AppxPackage}') + ''' -ExternalLocation ''' + ExpandConstant('{app}\appx') + ''''), '', SW_HIDE, ewWaitUntilTerminated, AddAppxPackageResultCode);
    RegDeleteKeyIncludingSubkeys({#EnvironmentRootKey}, 'Software\Classes\*\shell\{#RegValueName}');
    RegDeleteKeyIncludingSubkeys({#EnvironmentRootKey}, 'Software\Classes\directory\shell\{#RegValueName}');
    RegDeleteKeyIncludingSubkeys({#EnvironmentRootKey}, 'Software\Classes\directory\background\shell\{#RegValueName}');
    RegDeleteKeyIncludingSubkeys({#EnvironmentRootKey}, 'Software\Classes\Drive\shell\{#RegValueName}');
  end;
end;

procedure RemoveAppxPackage();
var
  RemoveAppxPackageResultCode: Integer;
begin
  ShellExec('', 'powershell.exe', '-Command ' + AddQuotes('Remove-AppxPackage -Package ''{#AppxPackageFullname}'''), '', SW_HIDE, ewWaitUntilTerminated, RemoveAppxPackageResultCode);
  if not WizardIsTaskSelected('addcontextmenufiles') then begin
    RegDeleteKeyIncludingSubkeys({#EnvironmentRootKey}, 'Software\Classes\{#RegValueName}ContextMenu');
  end;
end;
#endif

procedure CurStepChanged(CurStep: TSetupStep);
var
  UpdateResultCode: Integer;
	StartServiceResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    if IsBackgroundUpdate() then
    begin
      CreateMutex('{#AppMutex}-ready');

      Log('Checking whether application is still running...');
      while (CheckForMutexes('{#AppMutex}')) do
      begin
        Sleep(1000)
      end;
      Log('Application appears not to be running.');

      StopTunnelServiceIfNeeded();

      // inno_updater requires 3 arguments (exe of current installation, lock file status, and a string for the log)
      Exec(ExpandConstant('{app}\tools\inno_updater.exe'), ExpandConstant('"{app}\{#ExeBasename}.exe" ' + BoolToStr(LockFileExists()) + ' "Updating Positron..."'), '', SW_SHOW, ewWaitUntilTerminated, UpdateResultCode);
    end;

    if ShouldRestartTunnelService then
    begin
      // start the tunnel service
      Log('Restarting the tunnel service...');
      ShellExec('', ExpandConstant('"{app}\bin\{#ApplicationName}.cmd"'), 'tunnel service install', '', SW_HIDE, ewWaitUntilTerminated, StartServiceResultCode);
      Log('Starting the tunnel service completed with result code ' + IntToStr(StartServiceResultCode));
      ShouldRestartTunnelService := False
    end;
  end;
end;

// https://stackoverflow.com/a/23838239/261019
procedure Explode(var Dest: TArrayOfString; Text: String; Separator: String);
var
  i, p: Integer;
begin
  i := 0;
  repeat
    SetArrayLength(Dest, i+1);
    p := Pos(Separator,Text);
    if p > 0 then begin
      Dest[i] := Copy(Text, 1, p-1);
      Text := Copy(Text, p + Length(Separator), Length(Text));
      i := i + 1;
    end else begin
      Dest[i] := Text;
      Text := '';
    end;
  until Length(Text)=0;
end;

function NeedsAddPath(Param: string): boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue({#EnvironmentRootKey}, '{#EnvironmentKey}', 'Path', OrigPath)
  then begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + Param + ';', ';' + OrigPath + ';') = 0;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Path: string;
  VSCodePath: string;
  Parts: TArrayOfString;
  NewPath: string;
  i: Integer;
begin
  if not CurUninstallStep = usUninstall then begin
    exit;
  end;
  if not RegQueryStringValue({#EnvironmentRootKey}, '{#EnvironmentKey}', 'Path', Path)
  then begin
    exit;
  end;
  NewPath := '';
  VSCodePath := ExpandConstant('{app}\bin')
  Explode(Parts, Path, ';');
  for i:=0 to GetArrayLength(Parts)-1 do begin
    if CompareText(Parts[i], VSCodePath) <> 0 then begin
      NewPath := NewPath + Parts[i];

      if i < GetArrayLength(Parts) - 1 then begin
        NewPath := NewPath + ';';
      end;
    end;
  end;
  RegWriteExpandStringValue({#EnvironmentRootKey}, '{#EnvironmentKey}', 'Path', NewPath);
end;

#ifdef Debug
  #expr SaveToFile(AddBackslash(SourcePath) + "code-processed.iss")
#endif

// https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/icacls
// https://docs.microsoft.com/en-US/windows/security/identity-protection/access-control/security-identifiers
procedure DisableAppDirInheritance();
var
  ResultCode: Integer;
  Permissions: string;
begin
  Permissions := '/grant:r "*S-1-5-18:(OI)(CI)F" /grant:r "*S-1-5-32-544:(OI)(CI)F" /grant:r "*S-1-5-11:(OI)(CI)RX" /grant:r "*S-1-5-32-545:(OI)(CI)RX"';

  #if "user" == InstallTarget
    Permissions := Permissions + Format(' /grant:r "*S-1-3-0:(OI)(CI)F" /grant:r "%s:(OI)(CI)F"', [GetUserNameString()]);
  #endif

  Exec(ExpandConstant('{sys}\icacls.exe'), ExpandConstant('"{app}" /inheritancelevel:r ') + Permissions, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
