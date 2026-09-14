import SwiftUI
import ConnectionCore

private enum Palette {
    static let background = Color(red: 0.065, green: 0.075, blue: 0.072)
    static let panel = Color(red: 0.105, green: 0.12, blue: 0.11)
    static let lime = Color(red: 0.79, green: 0.98, blue: 0.38)
    static let secondary = Color(red: 0.61, green: 0.66, blue: 0.63)
}

struct ConnectionView: View {
    let model: ConnectionModel
    @State private var showDetails = false
    private var isReady: Bool { model.phase == .ready }
    private var statusColor: Color { isReady ? Palette.lime : model.phase == .attention ? .orange : Palette.secondary }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.bottom, 34)
            HStack(spacing: 9) {
                Circle().fill(statusColor).frame(width: 7, height: 7)
                Text(model.phase == .starting ? "CONNECTING" : isReady ? "ALL SYSTEMS READY" : "CONNECTION")
                    .font(.system(size: 10, weight: .bold, design: .monospaced)).tracking(1.8)
                    .foregroundStyle(statusColor)
            }
            .accessibilityElement(children: .combine)
            Text(model.title)
                .font(.system(size: 31, weight: .semibold)).tracking(-1.0)
                .padding(.top, 12)
                .accessibilityIdentifier("connection.status")
            Text(model.subtitle)
                .font(.system(size: 13)).foregroundStyle(Palette.secondary)
                .lineSpacing(3).fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: 36, alignment: .topLeading).padding(.top, 9)

            VStack(spacing: 0) {
                HealthRow(symbol: "bolt.horizontal", title: "Connection", value: isReady ? ConnectionHealth.latency(model.health?.pingMs) : model.phase == .starting ? "Starting..." : "Offline", ready: isReady)
                Divider().overlay(Color.white.opacity(0.04)).padding(.horizontal, 16)
                HealthRow(symbol: "terminal", title: "Commands", value: ConnectionHealth.latency(model.health?.lastCheck?.commandMs), ready: model.health?.lastCheck?.commandMs != nil)
                Divider().overlay(Color.white.opacity(0.04)).padding(.horizontal, 16)
                HealthRow(symbol: "photo", title: "Images", value: ConnectionHealth.latency(model.health?.lastCheck?.imageMs), ready: model.health?.lastCheck?.imageMs != nil)
            }
            .background(Palette.panel, in: .rect(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(.white.opacity(0.06), lineWidth: 1))
            .padding(.top, 22)

            HStack {
                Image(systemName: "link").font(.system(size: 11))
                Text(clientLabel).font(.system(size: 12))
                Spacer()
                if model.isChecking || model.phase == .starting {
                    ProgressView().controlSize(.small).scaleEffect(0.7)
                } else if let date = model.lastUpdated {
                    Text(date, style: .time).font(.system(size: 10, design: .monospaced))
                        .accessibilityLabel("Last checked \(date.formatted(date: .omitted, time: .standard))")
                }
            }
            .foregroundStyle(Palette.secondary).padding(.top, 16)

            HStack(spacing: 10) {
                Button {
                    if model.isRunning { model.stop() } else { model.start() }
                } label: {
                    Label(model.phase == .stopping ? "Stopping..." : model.isRunning ? "Stop connection" : "Start connection", systemImage: model.isRunning ? "stop.fill" : "bolt.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .frame(maxWidth: .infinity).frame(height: 42)
                        .foregroundStyle(model.isRunning ? Color.white : Palette.background)
                        .background(model.isRunning ? Color.white.opacity(0.08) : Palette.lime, in: .rect(cornerRadius: 11))
                }
                .buttonStyle(.plain).keyboardShortcut(.defaultAction)
                .disabled(model.phase == .stopping)
                .accessibilityIdentifier("connection.toggle")
                Button {
                    Task { await model.refresh(full: true) }
                } label: {
                    Label(model.isChecking ? "Checking" : "Check now", systemImage: "arrow.clockwise")
                        .font(.system(size: 13, weight: .semibold))
                        .frame(width: 131, height: 42)
                        .foregroundStyle(isReady ? Palette.background : Palette.secondary)
                        .background(isReady ? Palette.lime : Palette.panel, in: .rect(cornerRadius: 11))
                }
                .buttonStyle(.plain).disabled(!model.isRunning || model.phase == .starting || model.phase == .stopping || model.isChecking)
                .accessibilityIdentifier("connection.check")
            }
            .padding(.top, 27)
            if (model.health?.connectedCount ?? 0) > 0 {
                Text("Stopping disconnects active apps.").font(.system(size: 10)).foregroundStyle(Palette.secondary).padding(.top, 8)
            }

            DisclosureGroup("Details", isExpanded: $showDetails) {
                VStack(alignment: .leading, spacing: 9) {
                    Text("\(model.health?.toolCount ?? 0) tools  ·  \(model.health?.version ?? "Engine not started")")
                        .font(.system(size: 11, design: .monospaced))
                    Text("Checks measure the local engine. Connected apps keep their own sessions.")
                        .font(.system(size: 11)).fixedSize(horizontal: false, vertical: true)
                    ForEach((model.health?.events ?? []).suffix(3)) { event in
                        Text(event.message).font(.system(size: 11))
                    }
                    HStack(spacing: 16) {
                        Button(model.copied ? "Copied" : "Copy diagnostics", action: model.copyDiagnostics)
                        Button("Open project", action: model.openProject)
                    }.font(.system(size: 11)).buttonStyle(.link).tint(Palette.lime).padding(.top, 3)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.top, 10)
            }
            .font(.system(size: 11)).foregroundStyle(Palette.secondary).tint(Palette.secondary)
            .padding(.top, 24)
            HStack(spacing: 5) {
                Image(systemName: "lock.shield").font(.system(size: 10))
                Text("Only on this Mac").font(.system(size: 10))
                Spacer()
                Text("Stays in your menu bar").font(.system(size: 10))
            }.foregroundStyle(Palette.secondary.opacity(0.8)).padding(.top, 21)
        }
        .padding(.horizontal, 30).padding(.top, 34).padding(.bottom, 24)
        .frame(width: 460)
        .background(Palette.background).foregroundStyle(.white)
        .preferredColorScheme(.dark)
    }

    private var clientLabel: String {
        let count = model.health?.connectedCount ?? 0
        if count == 0 { return isReady ? "Waiting for an app to connect" : "No apps connected" }
        return "\(count) \(count == 1 ? "app" : "apps") connected"
    }

    private var header: some View {
        HStack(spacing: 11) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 23, weight: .bold)).foregroundStyle(Palette.background)
                .frame(width: 43, height: 43)
                .background(Palette.lime, in: .rect(cornerRadius: 12)).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("FAST").font(.system(size: 18, weight: .heavy, design: .rounded)).tracking(2.4)
                Text("Desktop Command").font(.system(size: 11)).foregroundStyle(Palette.secondary)
            }
            Spacer()
            Text("LOCAL").font(.system(size: 9, weight: .semibold, design: .monospaced)).tracking(1)
                .foregroundStyle(Palette.secondary).padding(.horizontal, 9).padding(.vertical, 5)
                .overlay(Capsule().stroke(Color.white.opacity(0.12), lineWidth: 1))
        }
    }
}

private struct HealthRow: View {
    let symbol: String
    let title: String
    let value: String
    let ready: Bool
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).font(.system(size: 14)).foregroundStyle(Palette.secondary).frame(width: 18)
            Text(title).font(.system(size: 13))
            Spacer()
            Text(value).font(.system(size: 12, weight: .medium, design: .monospaced)).foregroundStyle(ready ? Palette.lime : Palette.secondary)
        }.padding(.horizontal, 17).frame(height: 49)
            .accessibilityElement(children: .combine)
    }
}
