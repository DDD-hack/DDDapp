//
//  ContentView.swift
//  companion Watch App Watch App
//
//  Created by 乙津孝太朗 on 2026/05/17.
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var workoutManager: HeartRateWorkoutManager

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "heart.fill")
                .foregroundStyle(.red)

            if workoutManager.currentBPM > 0 {
                Text("\(Int(workoutManager.currentBPM))")
                    .font(.system(size: 48, weight: .bold, design: .rounded))
                Text("bpm")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text("---")
                    .font(.system(size: 48, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            if let error = workoutManager.errorMessage {
                Text(error)
                    .font(.system(size: 10))
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
        }
    }
}
