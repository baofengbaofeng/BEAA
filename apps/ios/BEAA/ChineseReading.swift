import Foundation

enum ChineseReading {
    static func pinyin(_ text: String) -> String {
        let overrides = ["重置": "chóng zhì", "重新": "chóng xīn", "家长": "jiā zhǎng", "快乐": "kuài lè"]
        var remaining = text[...]
        var result: [String] = []
        while !remaining.isEmpty {
            let matches = overrides.keys.compactMap { key -> (Range<String.Index>, String)? in
                remaining.range(of: key).map { ($0, key) }
            }
            guard let earliest = matches.min(by: { $0.0.lowerBound < $1.0.lowerBound }) else {
                result.append(String(remaining).applyingTransform(.mandarinToLatin, reverse: false) ?? String(remaining)); break
            }
            let prefix = String(remaining[..<earliest.0.lowerBound])
            if !prefix.isEmpty { result.append(prefix.applyingTransform(.mandarinToLatin, reverse: false) ?? prefix) }
            result.append(overrides[earliest.1]!)
            remaining = remaining[earliest.0.upperBound...]
        }
        return result.joined(separator: " ")
    }
}
