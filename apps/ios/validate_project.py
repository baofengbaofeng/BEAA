#!/usr/bin/env python3
"""Read-only structural verification; does not compile Swift or replace XCTest."""
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent
project = root/'BEAA.xcodeproj/project.pbxproj'
before = project.read_bytes()
subprocess.run([sys.executable, str(root/'generate_project.py'), '--check'], check=True)
assert project.read_bytes() == before, 'Check mode modified the project'
text = project.read_text()
objects = dict(re.findall(r'^([A-F0-9]{24}) = \{ ([^\n]+) \};$', text, re.M))
references = set(re.findall(r'\b[A-F0-9]{24}\b', text))
assert references <= objects.keys(), f'Unresolved project IDs: {references - objects.keys()}'

def field(body, name):
    match = re.search(r'\b' + re.escape(name) + r' = ([^;]+);', body)
    assert match, f'Missing {name}: {body}'
    return match[1].strip('"')

def id_list(body, name):
    return re.findall(r'[A-F0-9]{24}', field(body, name))

file_paths = {key: field(body, 'path') for key, body in objects.items()
              if body.startswith('isa = PBXFileReference;')}
targets = {field(body, 'name'): body for body in objects.values()
           if body.startswith('isa = PBXNativeTarget;')}
expected_targets = {'BEAA', 'BEAAConnected', 'BEAATests', 'BEAADeviceActivityMonitor',
                    'BEAAShieldConfiguration', 'BEAAShieldAction'}
assert set(targets) == expected_targets

def phase_members(target, phase_kind):
    members = []
    for phase_id in id_list(targets[target], 'buildPhases'):
        body = objects[phase_id]
        if body.startswith('isa = ' + phase_kind + ';'):
            for build_id in id_list(body, 'files'):
                members.append(file_paths[field(objects[build_id], 'fileRef')])
    return members

app_sources = {path.relative_to(root).as_posix() for path in (root/'BEAA').glob('*.swift')}
test_sources = {path.relative_to(root).as_posix() for path in (root/'BEAATests').glob('*.swift')}
expected_sources = {
    'BEAA': app_sources, 'BEAAConnected': app_sources, 'BEAATests': test_sources,
    'BEAADeviceActivityMonitor': {'BEAA/PlatformUsagePlanner.swift', 'BEAA/PlatformScreenTimeBridge.swift',
                                'Extensions/DeviceActivityMonitor/BEAADeviceActivityMonitor.swift'},
    'BEAAShieldConfiguration': {'Extensions/ShieldConfiguration/BEAAShieldConfiguration.swift'},
    'BEAAShieldAction': {'Extensions/ShieldAction/BEAAShieldAction.swift'},
}
for target, expected in expected_sources.items():
    actual = phase_members(target, 'PBXSourcesBuildPhase')
    assert len(actual) == len(set(actual)), f'Duplicate source membership: {target}'
    assert set(actual) == expected, f'Incorrect source membership: {target}'
    for path in actual:
        assert (root/path).is_file(), f'Missing source: {path}'

extension_products = {'BEAADeviceActivityMonitor.appex', 'BEAAShieldConfiguration.appex', 'BEAAShieldAction.appex'}
assert set(phase_members('BEAAConnected', 'PBXCopyFilesBuildPhase')) == extension_products
assert not phase_members('BEAA', 'PBXCopyFilesBuildPhase'), 'Practice must not embed privileged extensions'
assert not id_list(targets['BEAA'], 'dependencies'), 'Practice must not build privileged extensions'
connected_dependencies = {field(objects[dep], 'target') for dep in id_list(targets['BEAAConnected'], 'dependencies')}
extension_target_ids = {key for key, body in objects.items()
                        if body.startswith('isa = PBXNativeTarget;') and field(body, 'name') in
                        {'BEAADeviceActivityMonitor', 'BEAAShieldConfiguration', 'BEAAShieldAction'}}
assert connected_dependencies == extension_target_ids
for phase_id in id_list(targets['BEAAConnected'], 'buildPhases'):
    body = objects[phase_id]
    if body.startswith('isa = PBXCopyFilesBuildPhase;'):
        assert field(body, 'dstSubfolderSpec') == '13'
        for build_id in id_list(body, 'files'):
            assert 'CodeSignOnCopy' in objects[build_id] and 'RemoveHeadersOnCopy' in objects[build_id]

assert 'BEAA_BUNDLE_IDENTIFIER = org.beaa.learning' in (root/'Configuration/Common.xcconfig').read_text()
assert 'BEAA_BUNDLE_IDENTIFIER = your.organization.learning' in (root/'Configuration/User.xcconfig.example').read_text()
assert 'PRODUCT_BUNDLE_IDENTIFIER = org.beaa.learning' not in text, 'Owned identifiers must be configurable'
for mode, connected in [('Practice', False), ('Connected', True)]:
    info = plistlib.loads((root/f'Configuration/{mode}-Info.plist').read_bytes())
    for key in ['BEAAEnableScreenTime', 'BEAAEnableCloud', 'CKSharingSupported']:
        assert info[key] is connected, f'{key} must be literal boolean in {mode}'
    entitlements = plistlib.loads((root/f'Configuration/{mode}.entitlements').read_bytes())
    if connected:
        assert entitlements['com.apple.developer.family-controls'] is True
        assert entitlements['com.apple.security.application-groups'] == ['$(BEAA_APP_GROUP)']
    else:
        assert entitlements == {}, 'Practice must not request connected capabilities'

for name, target, point in [
    ('Monitor', 'BEAADeviceActivityMonitor', 'com.apple.deviceactivity.monitor-extension'),
    ('ShieldConfiguration', 'BEAAShieldConfiguration', 'com.apple.ManagedSettingsUI.shield-configuration-service'),
    ('ShieldAction', 'BEAAShieldAction', 'com.apple.ManagedSettings.shield-action-service'),
]:
    info = plistlib.loads((root/f'Configuration/{name}-Info.plist').read_bytes())
    assert info['NSExtension']['NSExtensionPointIdentifier'] == point
    assert info['NSExtension']['NSExtensionPrincipalClass'] == '$(PRODUCT_MODULE_NAME).' + target
    entitlement_path = f'Configuration/{name}.entitlements'
    entitlement = plistlib.loads((root/entitlement_path).read_bytes())
    assert entitlement['com.apple.developer.family-controls'] is True
    for config_id in id_list(objects[field(targets[target], 'buildConfigurationList')], 'buildConfigurations'):
        config = objects[config_id]
        assert 'APPLICATION_EXTENSION_API_ONLY = YES;' in config
        assert f'CODE_SIGN_ENTITLEMENTS = {entitlement_path};' in config
        assert 'SKIP_INSTALL = YES;' in config
monitor_info = plistlib.loads((root/'Configuration/Monitor-Info.plist').read_bytes())
assert monitor_info['BEAAEnableScreenTime'] is True
assert monitor_info['BEAAAppGroupIdentifier'] == '$(BEAA_APP_GROUP)'

for name in ['BEAA', 'BEAAConnected']:
    scheme = ET.parse(root/f'BEAA.xcodeproj/xcshareddata/xcschemes/{name}.xcscheme')
    assert scheme.find('.//BuildActionEntry/BuildableReference').attrib['BlueprintName'] == name
    testable = scheme.find('.//TestableReference/BuildableReference')
    assert (testable.attrib['BlueprintName'] if testable is not None else None) == ('BEAATests' if name == 'BEAA' else None)
assert 'WKWebView' not in ''.join(path.read_text() for path in (root/'BEAA').glob('*.swift'))
assert 'PinyinText' in (root/'BEAA/ParentView.swift').read_text()
assert '.atomic' in (root/'BEAA/Lifecycle.swift').read_text()
print('PASS: deterministic project, six targets, exact memberships, three connected extension signing configurations, practice gates, plists and schemes (not Swift compilation).')
