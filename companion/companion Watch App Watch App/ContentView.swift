import SwiftUI

struct ContentView: View {
    @Environment(WorkoutManager.self) private var workoutManager

    var body: some View {
        VStack(spacing: 12) {
            if workoutManager.currentBPM > 0 {
                Text("\(workoutManager.currentBPM)")
                    .font(.system(size: 48, weight: .bold, design: .rounded))
                    .foregroundStyle(.red)
                Text("BPM")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Image(systemName: "heart.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(.red)
                    .opacity(workoutManager.isRunning ? 1 : 0.3)
            }

            if let error = workoutManager.errorMessage {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            Button(workoutManager.isRunning ? "STOP" : "START") {
                if workoutManager.isRunning {
                    workoutManager.stop()
                } else {
                    workoutManager.requestAuthorizationAndStart()
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(workoutManager.isRunning ? .gray : .red)
        }
        .padding()
    }
}

#Preview {
    ContentView()
        .environment(WorkoutManager())
}
