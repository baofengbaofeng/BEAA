#!/usr/bin/env python3
"""Generate practice/connected apps, three extensions and tests; --check never modifies files."""
from pathlib import Path
import argparse, hashlib, plistlib
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check',action='store_true')
args=parser.parse_args()
root=Path(__file__).resolve().parent
out=root/'BEAA.xcodeproj'
def save(path,content):
    data=content if isinstance(content,bytes) else content.encode()
    if args.check:
        if not path.is_file() or path.read_bytes()!=data:
            raise SystemExit(f'Generated project is stale: {path.name}; local files were preserved')
    else:
        path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
def plist(path,value): save(path,plistlib.dumps(value,sort_keys=True))
common='''// Defaults are development examples. Override in ignored User.xcconfig.
BEAA_BUNDLE_IDENTIFIER = org.beaa.learning
BEAA_APP_GROUP = group.org.beaa.learning
BEAA_CLOUD_CONTAINER = iCloud.org.beaa.learning
BEAA_ICLOUD_ENVIRONMENT = Development
BEAA_PUSH_ENVIRONMENT = development
MARKETING_VERSION = 0.3.0
CURRENT_PROJECT_VERSION = 3
CODE_SIGN_STYLE = Automatic
#include? "User.xcconfig"
'''
save(root/'Configuration/Common.xcconfig',common)
save(root/'Configuration/User.xcconfig.example','// Copy to User.xcconfig and use identifiers owned by your developer team.\nDEVELOPMENT_TEAM = YOUR_TEAM_ID\nBEAA_BUNDLE_IDENTIFIER = your.organization.learning\nBEAA_APP_GROUP = group.your.organization.learning\nBEAA_CLOUD_CONTAINER = iCloud.your.organization.learning\n')
for mode,connected in [('Practice',False),('Connected',True)]:
    save(root/f'Configuration/{mode}.xcconfig', '#include "Common.xcconfig"\nCODE_SIGN_ENTITLEMENTS = Configuration/'+mode+'.entitlements\n')
    info={'CFBundleDevelopmentRegion':'zh_CN','CFBundleDisplayName':'学知守护','CFBundleExecutable':'$(EXECUTABLE_NAME)',
          'CFBundleIdentifier':'$(PRODUCT_BUNDLE_IDENTIFIER)','CFBundleInfoDictionaryVersion':'6.0','CFBundlePackageType':'APPL',
          'CFBundleShortVersionString':'$(MARKETING_VERSION)','CFBundleVersion':'$(CURRENT_PROJECT_VERSION)',
          'LSRequiresIPhoneOS':True,'UILaunchScreen':{},'UIDeviceFamily':[1,2],
          'UISupportedInterfaceOrientations':['UIInterfaceOrientationPortrait','UIInterfaceOrientationLandscapeLeft','UIInterfaceOrientationLandscapeRight'],
          'NSFaceIDUsageDescription':'家长可选择使用本机生物识别验证身份。\nJiā zhǎng kě xuǎn zé shǐ yòng běn jī shēng wù shí bié yàn zhèng shēn fèn.',
          'BEAAEnableScreenTime':connected,'BEAAEnableCloud':connected,'BEAAAppGroupIdentifier':'$(BEAA_APP_GROUP)',
          'BEAACloudContainerIdentifier':'$(BEAA_CLOUD_CONTAINER)','CKSharingSupported':connected}
    if connected: info['UIBackgroundModes']=['remote-notification']
    plist(root/f'Configuration/{mode}-Info.plist',info)
plist(root/'Configuration/Practice.entitlements',{})
plist(root/'Configuration/Connected.entitlements',{'com.apple.developer.family-controls':True,
      'com.apple.security.application-groups':['$(BEAA_APP_GROUP)'],
      'com.apple.developer.icloud-container-identifiers':['$(BEAA_CLOUD_CONTAINER)'],
      'com.apple.developer.icloud-services':['CloudKit'],
      'com.apple.developer.icloud-container-environment':'$(BEAA_ICLOUD_ENVIRONMENT)',
      'aps-environment':'$(BEAA_PUSH_ENVIRONMENT)'})
plist(root/'Configuration/Monitor.entitlements',{'com.apple.developer.family-controls':True,
      'com.apple.security.application-groups':['$(BEAA_APP_GROUP)']})
plist(root/'Configuration/Monitor-Info.plist',{'CFBundleDisplayName':'学知守护用时监控','CFBundleExecutable':'$(EXECUTABLE_NAME)',
      'CFBundleIdentifier':'$(PRODUCT_BUNDLE_IDENTIFIER)','CFBundleInfoDictionaryVersion':'6.0','CFBundlePackageType':'XPC!',
      'CFBundleShortVersionString':'$(MARKETING_VERSION)','CFBundleVersion':'$(CURRENT_PROJECT_VERSION)',
      'BEAAEnableScreenTime':True,'BEAAAppGroupIdentifier':'$(BEAA_APP_GROUP)',
      'NSExtension':{'NSExtensionPointIdentifier':'com.apple.deviceactivity.monitor-extension',
                     'NSExtensionPrincipalClass':'$(PRODUCT_MODULE_NAME).BEAADeviceActivityMonitor'}})
for extension, point in [('ShieldConfiguration', 'com.apple.ManagedSettingsUI.shield-configuration-service'),
                         ('ShieldAction', 'com.apple.ManagedSettings.shield-action-service')]:
    plist(root/f'Configuration/{extension}.entitlements', {'com.apple.developer.family-controls': True})
    plist(root/f'Configuration/{extension}-Info.plist', {
        'CFBundleDisplayName': '学知守护', 'CFBundleExecutable': '$(EXECUTABLE_NAME)',
        'CFBundleIdentifier': '$(PRODUCT_BUNDLE_IDENTIFIER)', 'CFBundleInfoDictionaryVersion': '6.0',
        'CFBundlePackageType': 'XPC!', 'CFBundleShortVersionString': '$(MARKETING_VERSION)',
        'CFBundleVersion': '$(CURRENT_PROJECT_VERSION)',
        'NSExtension': {'NSExtensionPointIdentifier': point,
                       'NSExtensionPrincipalClass': '$(PRODUCT_MODULE_NAME).BEAA' + extension}})
plist(root/'BEAA/Resources/PrivacyInfo.xcprivacy',{'NSPrivacyTracking':False,
      'NSPrivacyAccessedAPITypes':[
       {'NSPrivacyAccessedAPIType':'NSPrivacyAccessedAPICategoryUserDefaults','NSPrivacyAccessedAPITypeReasons':['CA92.1','C56D.1']},
       {'NSPrivacyAccessedAPIType':'NSPrivacyAccessedAPICategorySystemBootTime','NSPrivacyAccessedAPITypeReasons':['35F9.1']} ]})
objects={}
def ident(name): return hashlib.sha256(name.encode()).hexdigest()[:24].upper()
def add(name,body):
    key=ident(name);objects[key]=body;return key
def arr(values): return '('+', '.join(values)+')'
sources=sorted((root/'BEAA').glob('*.swift'))
tests=sorted((root/'BEAATests').glob('*.swift'))
resources=sorted(path for path in (root/'BEAA/Resources').rglob('*') if path.is_file())
monitor_sources=[root/'BEAA/PlatformUsagePlanner.swift',root/'BEAA/PlatformScreenTimeBridge.swift',root/'Extensions/DeviceActivityMonitor/BEAADeviceActivityMonitor.swift']
extension_definitions = [
    ('Monitor', 'BEAADeviceActivityMonitor', 'monitor', monitor_sources),
    ('ShieldConfiguration', 'BEAAShieldConfiguration', 'shieldconfiguration', [root/'Extensions/ShieldConfiguration/BEAAShieldConfiguration.swift']),
    ('ShieldAction', 'BEAAShieldAction', 'shieldaction', [root/'Extensions/ShieldAction/BEAAShieldAction.swift']),
]
refs={}
configuration_paths = [root/f'Configuration/{name}' for name in [
    'Common.xcconfig', 'Practice.xcconfig', 'Connected.xcconfig',
    'Practice-Info.plist', 'Connected-Info.plist', 'Practice.entitlements', 'Connected.entitlements',
    'Monitor-Info.plist', 'Monitor.entitlements',
    'ShieldConfiguration-Info.plist', 'ShieldConfiguration.entitlements',
    'ShieldAction-Info.plist', 'ShieldAction.entitlements']]
all_paths=sorted(set(sources+tests+resources+[path for _,_,_,paths in extension_definitions for path in paths]+configuration_paths))
for path in all_paths:
    relative=path.relative_to(root).as_posix()
    filetype='sourcecode.swift' if path.suffix=='.swift' else 'text.xcconfig' if path.suffix=='.xcconfig' else 'text.json' if path.suffix=='.json' else 'text.plist.xml'
    refs[relative]=add('ref:'+relative,f'isa = PBXFileReference; lastKnownFileType = {filetype}; path = "{relative}"; sourceTree = "<group>";')
def ref(path): return refs[path.relative_to(root).as_posix()]
products={}
for name,filetype in [('BEAA.app','wrapper.application'),('BEAAConnected.app','wrapper.application'),('BEAADeviceActivityMonitor.appex','wrapper.app-extension'),('BEAAShieldConfiguration.appex','wrapper.app-extension'),('BEAAShieldAction.appex','wrapper.app-extension'),('BEAATests.xctest','wrapper.cfbundle')]:
    products[name]=add('product:'+name,f'isa = PBXFileReference; explicitFileType = {filetype}; path = {name}; sourceTree = BUILT_PRODUCTS_DIR;')
product_group=add('products',f'isa = PBXGroup; name = Products; children = {arr(list(products.values()))}; sourceTree = "<group>";')
group=add('group',f'isa = PBXGroup; children = {arr(list(refs.values())+[product_group])}; sourceTree = "<group>";')
def phase(name,paths,kind='PBXSourcesBuildPhase'):
    builds=[add('build:'+name+':'+p.relative_to(root).as_posix(),f'isa = PBXBuildFile; fileRef = {ref(p)};') for p in paths]
    return add(name,f'isa = {kind}; buildActionMask = 2147483647; files = {arr(builds)}; runOnlyForDeploymentPostprocessing = 0;')
def configs(name,extra,mode=None):
    ids=[]
    for configuration in ['Debug','Release']:
        settings='CLANG_ENABLE_MODULES = YES; SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SWIFT_VERSION = 5.0; TARGETED_DEVICE_FAMILY = "1,2";'
        settings+=' SWIFT_OPTIMIZATION_LEVEL = "-Onone"; DEBUG_INFORMATION_FORMAT = dwarf; ENABLE_TESTABILITY = YES; SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;' if configuration=='Debug' else ' SWIFT_OPTIMIZATION_LEVEL = "-O";'
        base=f'baseConfigurationReference = {refs["Configuration/"+mode+".xcconfig"]};' if mode else ''
        ids.append(add(name+configuration,f'isa = XCBuildConfiguration; name = {configuration}; {base} buildSettings = {{ {settings} {extra} }};'))
    return add(name+'configs',f'isa = XCConfigurationList; buildConfigurations = {arr(ids)}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
def dependency(name,target):
    proxy=add(name+'proxy',f'isa = PBXContainerItemProxy; containerPortal = {ident("project")}; proxyType = 1; remoteGlobalIDString = {target}; remoteInfo = {name};')
    return add(name+'dependency',f'isa = PBXTargetDependency; target = {target}; targetProxy = {proxy};')
extension_targets={}
for configuration, target_name, suffix, target_sources in extension_definitions:
    target_configs=configs(target_name,
        f'PRODUCT_BUNDLE_IDENTIFIER = "$(BEAA_BUNDLE_IDENTIFIER).{suffix}"; PRODUCT_NAME = "$(TARGET_NAME)"; INFOPLIST_FILE = Configuration/{configuration}-Info.plist; GENERATE_INFOPLIST_FILE = NO; CODE_SIGN_ENTITLEMENTS = Configuration/{configuration}.entitlements; APPLICATION_EXTENSION_API_ONLY = YES; SKIP_INSTALL = YES;', 'Connected')
    extension_targets[target_name]=add(target_name+'-target',f'isa = PBXNativeTarget; name = {target_name}; productName = {target_name}; productReference = {products[target_name+".appex"]}; productType = "com.apple.product-type.app-extension"; buildConfigurationList = {target_configs}; buildPhases = {arr([phase(target_name+"-sources",target_sources)])}; buildRules = (); dependencies = ();')
app_targets={}
for name,mode in [('BEAA','Practice'),('BEAAConnected','Connected')]:
    config=configs(name,f'PRODUCT_BUNDLE_IDENTIFIER = "$(BEAA_BUNDLE_IDENTIFIER)"; PRODUCT_NAME = "$(TARGET_NAME)"; INFOPLIST_FILE = Configuration/{mode}-Info.plist; GENERATE_INFOPLIST_FILE = NO; INFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES;',mode)
    phases=[phase(name+'-sources',sources),phase(name+'-resources',resources,'PBXResourcesBuildPhase')]
    dependencies=[]
    if mode=='Connected':
        embedded=[]
        for target_name,target in extension_targets.items():
            embedded.append(add('embedded-'+target_name,f'isa = PBXBuildFile; fileRef = {products[target_name+".appex"]}; settings = {{ ATTRIBUTES = (CodeSignOnCopy, RemoveHeadersOnCopy); }};'))
            dependencies.append(dependency(target_name,target))
        phases.append(add('embed-extensions',f'isa = PBXCopyFilesBuildPhase; buildActionMask = 2147483647; dstPath = ""; dstSubfolderSpec = 13; files = {arr(embedded)}; name = "Embed App Extensions"; runOnlyForDeploymentPostprocessing = 0;'))
    app_targets[name]=add(name+'-target',f'isa = PBXNativeTarget; name = {name}; productName = {name}; productReference = {products[name+".app"]}; productType = "com.apple.product-type.application"; buildConfigurationList = {config}; buildPhases = {arr(phases)}; buildRules = (); dependencies = {arr(dependencies)};')
test_config=configs('tests','PRODUCT_BUNDLE_IDENTIFIER = "$(BEAA_BUNDLE_IDENTIFIER).tests"; PRODUCT_NAME = "$(TARGET_NAME)"; GENERATE_INFOPLIST_FILE = YES; TEST_HOST = "$(BUILT_PRODUCTS_DIR)/BEAA.app/BEAA"; BUNDLE_LOADER = "$(TEST_HOST)";','Practice')
test_target=add('tests-target',f'isa = PBXNativeTarget; name = BEAATests; productName = BEAATests; productReference = {products["BEAATests.xctest"]}; productType = "com.apple.product-type.bundle.unit-test"; buildConfigurationList = {test_config}; buildPhases = {arr([phase("test-sources",tests)])}; buildRules = (); dependencies = {arr([dependency("tests",app_targets["BEAA"])])};')
project_configs=configs('project','')
project=add('project',f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 1600; }}; buildConfigurationList = {project_configs}; compatibilityVersion = "Xcode 14.0"; developmentRegion = zh-Hans; knownRegions = ("zh-Hans", en, Base); mainGroup = {group}; productRefGroup = {product_group}; projectDirPath = ""; projectRoot = ""; targets = {arr(list(app_targets.values())+list(extension_targets.values())+[test_target])};')
text='// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'
text+='\n'.join(f'{key} = {{ {value} }};' for key,value in objects.items())
text+=f'\n}}; rootObject = {project}; }}\n'
save(out/'project.pbxproj',text)
def buildable(target,name): return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="{name}" BlueprintName="{name.split(".")[0]}" ReferencedContainer="container:BEAA.xcodeproj"/>'
for name,target in app_targets.items():
    app_ref=buildable(target,name+'.app')
    testables=f'<TestableReference skipped="NO">{buildable(test_target,"BEAATests.xctest")}</TestableReference>' if name=='BEAA' else ''
    save(out/f'xcshareddata/xcschemes/{name}.xcscheme',f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{app_ref}</BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables>{testables}</Testables></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{app_ref}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{app_ref}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>''')
print(f'{"Checked" if args.check else "Generated"} {len(sources)} app sources, {len(tests)} test sources, {len(resources)} resources and {len(extension_targets)} extensions.')
