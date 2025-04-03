# csen174ridesharecomparsion

Ride Comparison App

This app provides accurate price and time estimates across Uber, Lyft, and traditional taxi services by leveraging historical ride data. Rather than relying on restricted APIs, it uses statistical modeling based on collected ride information to predict costs for any route.
The system calculates estimates by analyzing distance, time of day, day of week, and known surge conditions. Results are presented with confidence intervals to account for pricing variability. Users can contribute their own ride data to continuously improve prediction accuracy, view price trends over time, and save frequent routes for quick comparison. The lightweight Flask-based web interface includes an interactive map for selecting pickup and dropoff locations.
